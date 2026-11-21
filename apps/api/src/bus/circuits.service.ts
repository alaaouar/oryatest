import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { TenancyService } from "../core/tenancy.service";
import { civilDate, requireSchool } from "../parent-space/common";
import { busView } from "./bus.service";
import type { CreateCircuitDto, CreateStopDto, SetCircuitStudentsDto, UpdateCircuitDto } from "./circuits.dto";

type Tx = Prisma.TransactionClient;

const CIRCUIT_SELECT = {
  id: true,
  name: true,
  active: true,
  attendantProfileId: true,
  attendant: { select: { displayName: true } },
  stops: { orderBy: { position: "asc" }, select: { id: true, name: true, position: true } },
  _count: { select: { students: true } },
} as const;

type CircuitRow = Prisma.BusCircuitGetPayload<{ select: typeof CIRCUIT_SELECT }>;

function view(c: CircuitRow) {
  return {
    id: c.id,
    name: c.name,
    active: c.active,
    attendantProfileId: c.attendantProfileId,
    attendant: c.attendant?.displayName ?? null,
    stops: c.stops,
    studentCount: c._count.students,
  };
}

/**
 * t92 (CDC 3.2 / 3.5 / 5) : circuits de transport (nom, arrêts ordonnés, élèves, accompagnateur unique).
 * Direction : gestion (MFA). Accompagnateur : lecture de SES circuits et feuille de route.
 * Aucune carte, position ni coordonnée (décision bloc 4).
 */
@Injectable()
export class CircuitsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  private async assertAttendant(tx: Tx, profileId: string) {
    const profile = await tx.userProfile.findFirst({ where: { id: profileId, role: "bus_attendant" }, select: { id: true } });
    if (!profile) throw new BadRequestException("Accompagnateur introuvable dans l'établissement.");
  }

  private async loadForRead(tx: Tx, auth: AuthContext, id: string) {
    const circuit = await tx.busCircuit.findFirst({ where: { id }, select: CIRCUIT_SELECT });
    if (!circuit) throw new NotFoundException("Circuit introuvable.");
    if (auth.role === "bus_attendant" && circuit.attendantProfileId !== auth.profileId) {
      throw new ForbiddenException("Ce circuit ne vous est pas confié.");
    }
    return circuit;
  }

  async list(auth: AuthContext) {
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const where: Prisma.BusCircuitWhereInput = auth.role === "bus_attendant" ? { attendantProfileId: auth.profileId, active: true } : {};
      const rows = await tx.busCircuit.findMany({ where, orderBy: { name: "asc" }, take: 200, select: CIRCUIT_SELECT });
      return { circuits: rows.map(view) };
    });
  }

  async attendants(auth: AuthContext) {
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const rows = await tx.userProfile.findMany({
        where: { role: "bus_attendant", schoolId: auth.schoolId },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true },
      });
      return { attendants: rows };
    });
  }

  async create(auth: AuthContext, dto: CreateCircuitDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const created = await this.tenancy.run(context, async (tx) => {
      if (dto.attendantProfileId) await this.assertAttendant(tx, dto.attendantProfileId);
      try {
        return await tx.busCircuit.create({
          data: { schoolId, name: dto.name.trim(), attendantProfileId: dto.attendantProfileId ?? null, createdById: auth.userId },
          select: CIRCUIT_SELECT,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictException("Un circuit porte déjà ce nom.");
        }
        throw error;
      }
    });
    await this.audit.scoped(context, {
      action: "bus.circuit.created",
      entity: "BusCircuit",
      entityId: created.id,
      metadata: { attendantAssigned: !!created.attendantProfileId },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return view(created);
  }

  async update(auth: AuthContext, id: string, dto: UpdateCircuitDto, client: ClientInfo) {
    requireSchool(auth);
    const context = toTenantContext(auth);
    const updated = await this.tenancy.run(context, async (tx) => {
      const existing = await tx.busCircuit.findFirst({ where: { id }, select: { id: true } });
      if (!existing) throw new NotFoundException("Circuit introuvable.");
      if (dto.attendantProfileId) await this.assertAttendant(tx, dto.attendantProfileId);
      return tx.busCircuit.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.attendantProfileId !== undefined ? { attendantProfileId: dto.attendantProfileId } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        select: CIRCUIT_SELECT,
      });
    });
    await this.audit.scoped(context, {
      action: "bus.circuit.updated",
      entity: "BusCircuit",
      entityId: id,
      severity: dto.attendantProfileId !== undefined ? "warning" : undefined,
      metadata: { fields: Object.keys(dto) },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return view(updated);
  }

  async addStop(auth: AuthContext, id: string, dto: CreateStopDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const circuit = await this.tenancy.run(context, async (tx) => {
      const existing = await tx.busCircuit.findFirst({ where: { id }, select: { id: true } });
      if (!existing) throw new NotFoundException("Circuit introuvable.");
      const last = await tx.busStop.findFirst({ where: { circuitId: id }, orderBy: { position: "desc" }, select: { position: true } });
      await tx.busStop.create({ data: { schoolId, circuitId: id, name: dto.name.trim(), position: (last?.position ?? 0) + 1 } });
      return tx.busCircuit.findFirstOrThrow({ where: { id }, select: CIRCUIT_SELECT });
    });
    await this.audit.scoped(context, { action: "bus.stop.created", entity: "BusCircuit", entityId: id, ip: client.ip, userAgent: client.userAgent });
    return view(circuit);
  }

  /** Remplace la liste des élèves du circuit ; un élève inscrit ailleurs est déplacé (un seul circuit). */
  async setStudents(auth: AuthContext, id: string, dto: SetCircuitStudentsDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const ids = [...new Set(dto.students.map((s) => s.studentId))];
    if (ids.length !== dto.students.length) throw new BadRequestException("Un élève apparaît deux fois.");
    const result = await this.tenancy.run(context, async (tx) => {
      const circuit = await tx.busCircuit.findFirst({ where: { id }, select: { id: true, stops: { select: { id: true } } } });
      if (!circuit) throw new NotFoundException("Circuit introuvable.");
      const found = await tx.student.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (found.length !== ids.length) throw new NotFoundException("Élève introuvable.");
      const stopIds = new Set(circuit.stops.map((s) => s.id));
      for (const s of dto.students) {
        if (s.stopId && !stopIds.has(s.stopId)) throw new BadRequestException("Arrêt hors de ce circuit.");
      }
      const removed = await tx.busCircuitStudent.deleteMany({ where: { circuitId: id, studentId: { notIn: ids } } });
      for (const s of dto.students) {
        await tx.busCircuitStudent.upsert({
          where: { studentId: s.studentId },
          create: { schoolId, circuitId: id, studentId: s.studentId, stopId: s.stopId ?? null },
          update: { circuitId: id, stopId: s.stopId ?? null },
        });
      }
      return { students: ids.length, removed: removed.count };
    });
    await this.audit.scoped(context, {
      action: "bus.circuit.students.set",
      entity: "BusCircuit",
      entityId: id,
      metadata: result,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return this.roadmap(auth, id);
  }

  /** Feuille de route : arrêts dans l'ordre, élèves et statut du jour (sans position). */
  async roadmap(auth: AuthContext, id: string, dateRaw?: string) {
    requireSchool(auth);
    const date = civilDate(dateRaw ?? new Date().toISOString().slice(0, 10), "Date");
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const circuit = await this.loadForRead(tx, auth, id);
      const members = await tx.busCircuitStudent.findMany({
        where: { circuitId: id },
        orderBy: { student: { displayName: "asc" } },
        select: { stopId: true, student: { select: { id: true, displayName: true } } },
      });
      const statuses = await tx.studentBusStatus.findMany({
        where: { date, studentId: { in: members.map((m) => m.student.id) } },
        select: { studentId: true, date: true, status: true, updatedAt: true },
      });
      const byStudent = new Map(statuses.map((s) => [s.studentId, busView(s)]));
      const entry = (m: (typeof members)[number]) => ({ id: m.student.id, displayName: m.student.displayName, bus: byStudent.get(m.student.id) ?? null });
      return {
        circuit: view(circuit),
        date: date.toISOString().slice(0, 10),
        stops: circuit.stops.map((stop) => ({ ...stop, students: members.filter((m) => m.stopId === stop.id).map(entry) })),
        withoutStop: members.filter((m) => !m.stopId).map(entry),
      };
    });
  }
}
