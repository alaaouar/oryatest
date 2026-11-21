import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { TenancyService } from "../core/tenancy.service";
import { civilDate, guardianUserIds, ownChild, requireSchool } from "./common";
import { NotificationsService } from "./notifications.service";
import type { CreateParentActionDto, ListParentActionsQueryDto } from "./parent-space.dto";

const ACTION_SELECT = {
  id: true,
  title: true,
  description: true,
  dueDate: true,
  status: true,
  completedAt: true,
  createdAt: true,
  justificationId: true,
  student: { select: { id: true, displayName: true, studentCode: true } },
} satisfies Prisma.ParentActionSelect;

/** CDC M4 : l'espace parent montre au plus 5 cartes « À faire » ouvertes à la fois. */
export const PARENT_OPEN_CARDS_MAX = 5;
const PARENT_DONE_CARDS = 20;

/** Actions demandées par l'école aux familles (document à fournir, rendez-vous…). */
@Injectable()
export class ParentActionsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(auth: AuthContext, dto: CreateParentActionDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const dueDate = dto.dueDate ? civilDate(dto.dueDate, "Échéance") : null;

    const result = await this.tenancy.run(context, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: dto.studentId }, select: { id: true, displayName: true } });
      if (!student) throw new NotFoundException("Élève introuvable.");
      const action = await tx.parentAction.create({
        data: {
          schoolId,
          studentId: student.id,
          title: dto.title.trim(),
          description: dto.description?.trim() || null,
          dueDate,
          createdById: auth.userId,
        },
        select: ACTION_SELECT,
      });
      const notified = await this.notifications.notifyUsers(tx, schoolId, await guardianUserIds(tx, student.id), {
        kind: "parent_action.requested",
        title: `Action demandée pour ${student.displayName}`,
        body: action.title,
        link: "/family",
      });
      return { action, notified };
    });

    await this.audit.scoped(context, {
      action: "student.parent_action.created",
      entity: "Student",
      entityId: dto.studentId,
      metadata: { actionId: result.action.id, title: result.action.title, notified: result.notified },
      ...client,
    });
    return { ...toView(result.action), notified: result.notified };
  }

  async listForSchool(auth: AuthContext, query: ListParentActionsQueryDto) {
    requireSchool(auth);
    const rows = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.parentAction.findMany({
        where: { ...(query.studentId ? { studentId: query.studentId } : {}), ...(query.status ? { status: query.status } : {}) },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 200,
        select: ACTION_SELECT,
      }),
    );
    return rows.map(toView);
  }

  async cancel(auth: AuthContext, id: string, client: ClientInfo) {
    const context = toTenantContext(auth);
    requireSchool(auth);
    const row = await this.tenancy.run(context, async (tx) => {
      const current = await tx.parentAction.findFirst({ where: { id }, select: { status: true } });
      if (!current) throw new NotFoundException("Action introuvable.");
      if (current.status !== "open") throw new ConflictException("Cette action n'est plus ouverte.");
      return tx.parentAction.update({ where: { id }, data: { status: "cancelled" }, select: ACTION_SELECT });
    });
    await this.audit.scoped(context, {
      action: "student.parent_action.cancelled",
      entity: "Student",
      entityId: row.student.id,
      metadata: { actionId: id },
      ...client,
    });
    return toView(row);
  }

  /**
   * t92 M4 : au plus PARENT_OPEN_CARDS_MAX cartes ouvertes (échéance la plus proche d'abord,
   * sans échéance en dernier, puis la plus ancienne), suivies des dernières cartes terminées.
   * openTotal / hiddenOpen indiquent combien d'actions attendent au-delà des 5 affichées.
   */
  async listForParent(auth: AuthContext) {
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const mine = { student: ownChild(auth) } satisfies Prisma.ParentActionWhereInput;
      const [open, openTotal, done] = await Promise.all([
        tx.parentAction.findMany({
          where: { ...mine, status: "open" },
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          take: PARENT_OPEN_CARDS_MAX,
          select: ACTION_SELECT,
        }),
        tx.parentAction.count({ where: { ...mine, status: "open" } }),
        tx.parentAction.findMany({
          where: { ...mine, status: "done" },
          orderBy: { completedAt: "desc" },
          take: PARENT_DONE_CARDS,
          select: ACTION_SELECT,
        }),
      ]);
      return {
        actions: [...open, ...done].map(toView),
        openTotal,
        hiddenOpen: Math.max(0, openTotal - open.length),
        maxOpen: PARENT_OPEN_CARDS_MAX,
      };
    });
  }

  async complete(auth: AuthContext, id: string, client: ClientInfo) {
    requireSchool(auth);
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, async (tx) => {
      const current = await tx.parentAction.findFirst({
        where: { id, student: ownChild(auth) },
        select: { status: true, justification: { select: { status: true } } },
      });
      if (!current) throw new NotFoundException("Action introuvable.");
      if (current.status !== "open") throw new ConflictException("Cette action n'est plus ouverte.");
      if (current.justification?.status === "incomplete") {
        throw new ConflictException("Complétez le justificatif : la carte se fermera automatiquement.");
      }
      return tx.parentAction.update({
        where: { id },
        data: { status: "done", completedById: auth.userId, completedAt: new Date() },
        select: ACTION_SELECT,
      });
    });
    await this.audit.scoped(context, {
      action: "student.parent_action.completed",
      entity: "Student",
      entityId: row.student.id,
      metadata: { actionId: id },
      ...client,
    });
    return toView(row);
  }
}

type Row = Prisma.ParentActionGetPayload<{ select: typeof ACTION_SELECT }>;

function toView(row: Row) {
  return {
    id: row.id,
    student: row.student,
    title: row.title,
    description: row.description,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    status: row.status,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    justificationId: row.justificationId,
  };
}
