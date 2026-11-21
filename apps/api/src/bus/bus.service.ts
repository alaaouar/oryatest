import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { BusStatus, Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../parent-space/notifications.service";
import { attendantStudentIds } from "./circuits.query";
import { TenancyService } from "../core/tenancy.service";
import { civilDate, ownChild, requireSchool } from "../parent-space/common";
import type { SetBusStatusDto } from "./bus.dto";

type Tx = Prisma.TransactionClient;

export const BUS_LABELS: Record<BusStatus, string> = {
  not_planned: "Pas de transport prevu",
  waiting: "En attente du bus",
  on_board: "Dans le bus",
  dropped_off: "Depose",
  absent: "Absent du bus",
};

/**
 * Bloc 4 : statut du bus SEULEMENT. Aucune carte, position, trajet ni
 * coordonnee n'est stockee ni renvoyee (vue fermee ci-dessous).
 */
export function busView(row: { date: Date; status: BusStatus; updatedAt: Date }) {
  return {
    date: row.date.toISOString().slice(0, 10),
    status: row.status,
    label: BUS_LABELS[row.status],
    updatedAt: row.updatedAt.toISOString(),
  };
}

const BUS_SELECT = { date: true, status: true, updatedAt: true } as const;

/**
 * Decision t50u : la saisie du statut par l'accompagnateur est derriere un drapeau,
 * DESACTIVE par defaut (BUS_ATTENDANT_UPDATES_ENABLED=1 pour l'activer).
 * t92 : les circuits existent ; drapeau actif, l'accompagnateur ne saisit et ne voit QUE les
 * eleves de ses circuits actifs (403 sinon). La direction peut toujours saisir.
 */
export function busAttendantUpdatesEnabled(): boolean {
  const raw = (process.env.BUS_ATTENDANT_UPDATES_ENABLED ?? "0").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function today(): Date {
  return civilDate(new Date().toISOString().slice(0, 10), "Date");
}

/** Statuts des 7 derniers jours d'un eleve (appel deja autorise). */
export async function busHistory(tx: Tx, studentId: string) {
  const since = new Date(today().getTime() - 6 * 86_400_000);
  const rows = await tx.studentBusStatus.findMany({
    where: { studentId, date: { gte: since } },
    orderBy: { date: "desc" },
    select: BUS_SELECT,
  });
  const todayKey = today().toISOString().slice(0, 10);
  const views = rows.map(busView);
  return { today: views.find((v) => v.date === todayKey) ?? null, history: views };
}

@Injectable()
export class BusService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async setStatus(auth: AuthContext, dto: SetBusStatusDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    if (auth.role !== "bus_attendant" && auth.role !== "direction") throw new ForbiddenException();
    if (auth.role === "bus_attendant" && !busAttendantUpdatesEnabled()) {
      throw new ForbiddenException("Saisie du bus par l'accompagnateur desactivee (BUS_ATTENDANT_UPDATES_ENABLED).");
    }
    const date = dto.date ? civilDate(dto.date, "Date") : today();
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: dto.studentId }, select: { id: true, displayName: true } });
      if (!student) throw new NotFoundException("Eleve introuvable.");
      if (auth.role === "bus_attendant" && !(await attendantStudentIds(tx, auth.profileId)).has(student.id)) {
        throw new ForbiddenException("Eleve hors de vos circuits.");
      }
      const saved = await tx.studentBusStatus.upsert({
        where: { studentId_date: { studentId: dto.studentId, date } },
        create: { schoolId, studentId: dto.studentId, date, status: dto.status, updatedById: auth.userId },
        update: { status: dto.status, updatedById: auth.userId },
        select: BUS_SELECT,
      });
      await this.alertFamilies(tx, schoolId, student, saved);
      return saved;
    });
    await this.audit.scoped(context, {
      action: "bus.status.set",
      entity: "Student",
      entityId: dto.studentId,
      metadata: { status: dto.status, date: date.toISOString().slice(0, 10) },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return busView(row);
  }

  /**
   * t92 (CDC 5) : alerte transport in-app aux parents ayant donne le consentement
   * « transport_alerts » pour cet eleve (actif, non retire) ; montee, depose, absent du bus.
   * Une seule alerte par eleve, jour et statut.
   */
  private async alertFamilies(
    tx: Tx,
    schoolId: string,
    student: { id: string; displayName: string },
    row: { date: Date; status: BusStatus },
  ) {
    if (row.status !== "on_board" && row.status !== "dropped_off" && row.status !== "absent") return;
    const consents = await tx.parentalConsent.findMany({
      where: { studentId: student.id, purpose: "transport_alerts", revokedAt: null, userId: { not: null } },
      select: { userId: true },
    });
    const userIds = [...new Set(consents.map((c) => c.userId).filter((u): u is string => !!u))];
    if (userIds.length === 0) return;
    const day = row.date.toISOString().slice(0, 10);
    const link = `/family?bus=${day}&eleve=${student.id}&statut=${row.status}`;
    const already = await tx.notification.findMany({ where: { link, userId: { in: userIds } }, select: { userId: true } });
    const done = new Set(already.map((n) => n.userId));
    await this.notifications.notifyUsers(tx, schoolId, userIds.filter((u) => !done.has(u)), {
      kind: "bus.status",
      title: `${student.displayName} : ${BUS_LABELS[row.status]}`,
      body: "Alerte transport de l'\u00e9cole (sans position ni carte).",
      link,
    });
  }

  async listForDate(auth: AuthContext, dateRaw?: string) {
    requireSchool(auth);
    if (auth.role !== "bus_attendant" && auth.role !== "direction") throw new ForbiddenException();
    const date = dateRaw ? civilDate(dateRaw, "Date") : today();
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const scope = auth.role === "bus_attendant" ? { studentId: { in: [...(await attendantStudentIds(tx, auth.profileId))] } } : {};
      const rows = await tx.studentBusStatus.findMany({
        where: { date, ...scope },
        orderBy: { updatedAt: "desc" },
        take: 1000,
        select: { ...BUS_SELECT, student: { select: { id: true, displayName: true } } },
      });
      return {
        date: date.toISOString().slice(0, 10),
        items: rows.map((r) => ({ student: r.student, ...busView(r) })),
      };
    });
  }

  async forParent(auth: AuthContext, studentId: string) {
    requireSchool(auth);
    if (auth.role !== "parent") throw new ForbiddenException();
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const child = await tx.student.findFirst({ where: { id: studentId, ...ownChild(auth) }, select: { id: true } });
      if (!child) throw new NotFoundException("Eleve introuvable.");
      return busHistory(tx, studentId);
    });
  }
}