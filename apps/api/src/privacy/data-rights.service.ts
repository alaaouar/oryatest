import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { TenancyService } from "../core/tenancy.service";
import type { CloseDataRightsDto, CreateDataRightsDto } from "./privacy.dto";

const SELECT = {
  id: true,
  kind: true,
  subject: true,
  message: true,
  status: true,
  createdAt: true,
  handledAt: true,
  response: true,
} as const;

/**
 * Bloc 4 : droits de rectification et d'opposition. Une DEMANDE tracee et
 * auditee, adressee a l'ecole (responsable de traitement). Aucune donnee n'est
 * modifiee automatiquement : la direction traite puis clot avec une reponse.
 */
@Injectable()
export class DataRightsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async create(auth: AuthContext, dto: CreateDataRightsDto, client: ClientInfo) {
    if (!auth.schoolId) throw new ForbiddenException("Un etablissement actif est requis.");
    const schoolId = auth.schoolId;
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, (tx) =>
      tx.dataRightsRequest.create({
        data: { schoolId, userId: auth.userId, kind: dto.kind, subject: dto.subject.trim(), message: dto.message.trim() },
        select: SELECT,
      }),
    );
    await this.audit.scoped(context, {
      action: `privacy.rights.${dto.kind}.requested`,
      entity: "DataRightsRequest",
      entityId: row.id,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return view(row);
  }

  listMine(auth: AuthContext) {
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const rows = await tx.dataRightsRequest.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: SELECT,
      });
      return { items: rows.map(view) };
    });
  }

  listForSchool(auth: AuthContext, status?: "open" | "closed") {
    if (auth.role !== "direction" || !auth.schoolId) throw new ForbiddenException();
    const schoolId = auth.schoolId;
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const rows = await tx.dataRightsRequest.findMany({
        where: { schoolId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { ...SELECT, user: { select: { email: true } } },
      });
      return { items: rows.map((r) => ({ ...view(r), requester: r.user.email })) };
    });
  }

  async close(auth: AuthContext, id: string, dto: CloseDataRightsDto, client: ClientInfo) {
    if (auth.role !== "direction" || !auth.schoolId) throw new ForbiddenException();
    const schoolId = auth.schoolId;
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, async (tx) => {
      const current = await tx.dataRightsRequest.findFirst({ where: { id, schoolId }, select: { status: true } });
      if (!current) throw new NotFoundException("Demande introuvable.");
      if (current.status === "closed") throw new ConflictException("Demande deja close.");
      return tx.dataRightsRequest.update({
        where: { id },
        data: { status: "closed", handledAt: new Date(), handledById: auth.userId, response: dto.response.trim() },
        select: SELECT,
      });
    });
    await this.audit.scoped(context, {
      action: "privacy.rights.closed",
      entity: "DataRightsRequest",
      entityId: id,
      metadata: { kind: row.kind },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return view(row);
  }
}

function view(row: { id: string; kind: string; subject: string; message: string; status: string; createdAt: Date; handledAt: Date | null; response: string | null }) {
  return {
    id: row.id,
    kind: row.kind,
    subject: row.subject,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    handledAt: row.handledAt?.toISOString() ?? null,
    response: row.response,
  };
}