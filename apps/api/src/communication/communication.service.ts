import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { NotificationDispatcher } from "../channels/channels";
import { schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import type { ListFamilyMessagesQueryDto, ReplyDto, SendMessageDto } from "./communication.dto";

type Tx = Prisma.TransactionClient;

const KIND_AUDIENCE: Record<SendMessageDto["kind"], SendMessageDto["audience"][]> = {
  announcement: ["school", "level", "classroom", "selection"],
  event: ["school", "level", "classroom", "selection"],
  class_message: ["classroom"],
  direct: ["student"],
};

/** Identifiants dédoublonnés (sélection d'élèves). */
function uniqueIds(ids: string[] | undefined): string[] {
  return [...new Set(ids ?? [])];
}

function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) throw new ForbiddenException("Un établissement actif est requis.");
  return auth.schoolId;
}

/**
 * Communication école-famille (lot 5, in-app). Seuls les comptes parents
 * rattachés aux élèves visés reçoivent le message ; la lecture et l'accusé de
 * réception sont suivis par destinataire.
 */
@Injectable()
export class CommunicationService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  channels() {
    return { channels: this.dispatcher.list() };
  }

  /** Classes de l'enseignant pour l'année en cours. */
  private async teacherClassroomIds(tx: Tx, auth: AuthContext, schoolYear: string): Promise<Set<string>> {
    const rows = await tx.teacherClassroomAssignment.findMany({
      where: { teacherProfileId: auth.profileId, schoolYear },
      select: { classroomId: true },
    });
    return new Set(rows.map((row) => row.classroomId));
  }

  private async resolveRecipients(tx: Tx, dto: SendMessageDto, schoolYear: string) {
    const where: Prisma.StudentGuardianWhereInput = { guardian: { userId: { not: null } } };
    if (dto.audience === "classroom") {
      where.student = { enrollments: { some: { classroomId: dto.classroomId, schoolYear } } };
    } else if (dto.audience === "student") {
      where.studentId = dto.studentId;
    } else if (dto.audience === "level") {
      where.student = { enrollments: { some: { schoolYear, classroom: { level: dto.level } } } };
    } else if (dto.audience === "selection") {
      where.studentId = { in: uniqueIds(dto.studentIds) };
    }
    const links = await tx.studentGuardian.findMany({
      where,
      select: { studentId: true, guardian: { select: { userId: true } } },
    });
    const byUser = new Map<string, string | null>();
    for (const link of links) {
      const userId = link.guardian.userId;
      if (userId && !byUser.has(userId)) {
        byUser.set(userId, dto.audience === "school" || dto.audience === "level" ? null : link.studentId);
      }
    }
    return byUser;
  }

  async send(auth: AuthContext, dto: SendMessageDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    if (auth.role === "direction" && !auth.mfa) {
      throw new ForbiddenException("Authentification renforcée requise pour cette action.");
    }
    if (!KIND_AUDIENCE[dto.kind].includes(dto.audience)) {
      throw new BadRequestException("Ce type de message ne correspond pas à ce public.");
    }
    if (dto.audience === "classroom" && !dto.classroomId) throw new BadRequestException("Classe requise.");
    if (dto.audience === "student" && !dto.studentId) throw new BadRequestException("Élève requis.");
    const level = dto.level?.trim() || null;
    if (dto.audience === "level" && !level) throw new BadRequestException("Niveau requis.");
    if (dto.audience === "level") dto.level = level!;
    if (dto.audience === "selection" && !dto.studentIds?.length) throw new BadRequestException("Sélectionnez au moins un élève.");
    if (dto.kind === "event" && !dto.eventAt) throw new BadRequestException("Date de l'événement requise.");
    if (auth.role === "teacher" && (dto.audience === "school" || dto.audience === "level")) {
      throw new ForbiddenException("Un enseignant écrit à ses classes ou à une famille de ses classes.");
    }

    const context = toTenantContext(auth);
    const schoolYear = schoolYearForDate(new Date());

    const result = await this.tenancy.run(context, async (tx) => {
      if (dto.classroomId) {
        const classroom = await tx.classroom.findFirst({ where: { id: dto.classroomId }, select: { id: true } });
        if (!classroom) throw new NotFoundException("Classe introuvable.");
      }
      if (dto.studentId) {
        const student = await tx.student.findFirst({ where: { id: dto.studentId }, select: { id: true } });
        if (!student) throw new NotFoundException("Élève introuvable.");
      }
      if (dto.audience === "level") {
        const classroom = await tx.classroom.findFirst({ where: { level: dto.level }, select: { id: true } });
        if (!classroom) throw new NotFoundException("Aucune classe de ce niveau dans l'établissement.");
      }
      const selection = dto.audience === "selection" ? uniqueIds(dto.studentIds) : [];
      if (selection.length > 0) {
        // RLS : seuls les élèves de l'école sont visibles ; un identifiant étranger ou inconnu bloque l'envoi.
        const found = await tx.student.count({ where: { id: { in: selection } } });
        if (found !== selection.length) throw new NotFoundException("Élève introuvable dans la sélection.");
      }
      if (auth.role === "teacher") {
        const mine = await this.teacherClassroomIds(tx, auth, schoolYear);
        if (dto.audience === "classroom" && !mine.has(dto.classroomId!)) {
          throw new ForbiddenException("Cette classe ne vous est pas affectée.");
        }
        if (dto.audience === "student") {
          const enrolled = await tx.enrollment.findFirst({
            where: { studentId: dto.studentId, schoolYear, classroomId: { in: [...mine] } },
            select: { id: true },
          });
          if (!enrolled) throw new ForbiddenException("Cet élève n'est pas dans vos classes.");
        }
        if (dto.audience === "selection") {
          const inMine = await tx.enrollment.findMany({
            where: { studentId: { in: selection }, schoolYear, classroomId: { in: [...mine] } },
            select: { studentId: true },
            distinct: ["studentId"],
          });
          if (inMine.length !== selection.length) throw new ForbiddenException("Un élève de la sélection n'est pas dans vos classes.");
        }
      }

      const recipients = await this.resolveRecipients(tx, dto, schoolYear);
      const message = await tx.message.create({
        data: {
          schoolId,
          kind: dto.kind,
          audience: dto.audience,
          classroomId: dto.audience === "classroom" ? dto.classroomId : null,
          studentId: dto.audience === "student" ? dto.studentId : null,
          level: dto.audience === "level" ? dto.level : null,
          targetStudentIds: selection,
          title: dto.title.trim(),
          body: dto.body.trim(),
          important: dto.important ?? false,
          requiresAck: dto.requiresAck ?? false,
          eventAt: dto.eventAt ? new Date(dto.eventAt) : null,
          eventLocation: dto.eventLocation?.trim() || null,
          authorId: auth.userId,
          authorRole: auth.role,
        },
        select: { id: true, kind: true, title: true, createdAt: true },
      });
      if (recipients.size > 0) {
        await tx.messageRecipient.createMany({
          data: [...recipients].map(([userId, studentId]) => ({ schoolId, messageId: message.id, userId, studentId })),
        });
      }
      const delivery = await this.dispatcher.dispatch(
        tx,
        schoolId,
        [...recipients.keys()],
        {
          kind: dto.important ? "message.important" : "message.new",
          title: `${dto.important ? "Important : " : ""}${message.title}`,
          body: dto.body.trim().slice(0, 200),
          link: `/family/messages/${message.id}`,
        },
        dto.channels ?? [],
      );
      return { message, recipients: recipients.size, delivery };
    });

    await this.audit.scoped(context, {
      action: "message.sent",
      entity: "Message",
      entityId: result.message.id,
      metadata: {
        kind: dto.kind,
        audience: dto.audience,
        classroomId: dto.classroomId ?? null,
        studentId: dto.studentId ?? null,
        level: dto.audience === "level" ? dto.level : null,
        selection: dto.audience === "selection" ? uniqueIds(dto.studentIds).length : null,
        recipients: result.recipients,
        channels: result.delivery.map((entry) => `${entry.channel}:${entry.status}`),
      },
      ...client,
    });
    return { id: result.message.id, recipients: result.recipients, delivery: result.delivery };
  }

  /** Messages envoyés : toute l'école pour la direction, les siens pour un enseignant. */
  async listSent(auth: AuthContext) {
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const messages = await tx.message.findMany({
        where: auth.role === "teacher" ? { authorId: auth.userId } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          kind: true,
          audience: true,
          title: true,
          important: true,
          requiresAck: true,
          eventAt: true,
          createdAt: true,
          authorRole: true,
          level: true,
          targetStudentIds: true,
          classroom: { select: { id: true, name: true } },
          student: { select: { id: true, displayName: true } },
          _count: { select: { recipients: true, replies: true } },
        },
      });
      const ids = messages.map((message) => message.id);
      const [read, acked] = await Promise.all([
        tx.messageRecipient.groupBy({ by: ["messageId"], where: { messageId: { in: ids }, readAt: { not: null } }, _count: { _all: true } }),
        tx.messageRecipient.groupBy({ by: ["messageId"], where: { messageId: { in: ids }, acknowledgedAt: { not: null } }, _count: { _all: true } }),
      ]);
      const readMap = new Map(read.map((row) => [row.messageId, row._count._all]));
      const ackMap = new Map(acked.map((row) => [row.messageId, row._count._all]));
      return messages.map(({ _count, targetStudentIds, ...message }) => ({
        ...message,
        studentIds: targetStudentIds,
        recipients: _count.recipients,
        replies: _count.replies,
        readCount: readMap.get(message.id) ?? 0,
        ackCount: ackMap.get(message.id) ?? 0,
      }));
    });
  }

  /** Détail côté école avec suivi de lecture par parent et historique des échanges. */
  async detailForStaff(auth: AuthContext, id: string) {
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const message = await tx.message.findFirst({
        where: auth.role === "teacher" ? { id, authorId: auth.userId } : { id },
        select: {
          id: true,
          kind: true,
          audience: true,
          title: true,
          body: true,
          important: true,
          requiresAck: true,
          eventAt: true,
          eventLocation: true,
          createdAt: true,
          classroom: { select: { id: true, name: true } },
          student: { select: { id: true, displayName: true } },
          recipients: {
            orderBy: { createdAt: "asc" },
            select: {
              userId: true,
              readAt: true,
              acknowledgedAt: true,
              user: { select: { email: true, guardians: { select: { fullName: true }, take: 1 } } },
            },
          },
          replies: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, authorRole: true, createdAt: true } },
        },
      });
      if (!message) throw new NotFoundException("Message introuvable.");
      const { recipients, ...rest } = message;
      return {
        ...rest,
        tracking: recipients.map((recipient) => ({
          name: recipient.user.guardians[0]?.fullName ?? recipient.user.email,
          readAt: recipient.readAt,
          acknowledgedAt: recipient.acknowledgedAt,
        })),
      };
    });
  }

  async replyAsStaff(auth: AuthContext, id: string, dto: ReplyDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const reply = await this.tenancy.run(context, async (tx) => {
      const message = await tx.message.findFirst({
        where: auth.role === "teacher" ? { id, authorId: auth.userId } : { id },
        select: { id: true, kind: true, title: true, recipients: { select: { userId: true } } },
      });
      if (!message) throw new NotFoundException("Message introuvable.");
      if (message.kind !== "direct") throw new BadRequestException("Les réponses sont réservées aux échanges individuels.");
      const created = await tx.messageReply.create({
        data: { schoolId, messageId: id, authorId: auth.userId, authorRole: auth.role, body: dto.body.trim() },
        select: { id: true, body: true, authorRole: true, createdAt: true },
      });
      await this.dispatcher.dispatch(tx, schoolId, message.recipients.map((entry) => entry.userId), {
        kind: "message.reply",
        title: `Réponse de l'école : ${message.title}`,
        body: dto.body.trim().slice(0, 200),
        link: `/family/messages/${id}`,
      });
      return created;
    });
    await this.audit.scoped(context, { action: "message.replied", entity: "Message", entityId: id, ...client });
    return reply;
  }

  /* --- Côté parent ------------------------------------------------------ */

  async listForParent(auth: AuthContext, query: ListFamilyMessagesQueryDto) {
    requireSchool(auth);
    const rows = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.messageRecipient.findMany({
        where: { userId: auth.userId, ...(query.kind ? { message: { kind: query.kind } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          readAt: true,
          acknowledgedAt: true,
          message: {
            select: {
              id: true,
              kind: true,
              title: true,
              body: true,
              important: true,
              requiresAck: true,
              eventAt: true,
              eventLocation: true,
              createdAt: true,
              classroom: { select: { name: true } },
              student: { select: { displayName: true } },
              _count: { select: { replies: true } },
            },
          },
        },
      }),
    );
    return rows.map(({ message: { _count, body, ...message }, ...state }) => ({
      ...message,
      preview: body.slice(0, 180),
      replies: _count.replies,
      ...state,
    }));
  }

  /** Ouvre un message reçu : le marque lu (accusé de lecture). */
  async openForParent(auth: AuthContext, id: string) {
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const recipient = await tx.messageRecipient.findFirst({
        where: { messageId: id, userId: auth.userId },
        select: { id: true, readAt: true, acknowledgedAt: true },
      });
      if (!recipient) throw new NotFoundException("Message introuvable.");
      const readAt = recipient.readAt ?? new Date();
      if (!recipient.readAt) await tx.messageRecipient.update({ where: { id: recipient.id }, data: { readAt } });
      const message = await tx.message.findFirstOrThrow({
        where: { id },
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          important: true,
          requiresAck: true,
          eventAt: true,
          eventLocation: true,
          createdAt: true,
          classroom: { select: { name: true } },
          student: { select: { displayName: true } },
          replies: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, authorRole: true, createdAt: true, authorId: true } },
        },
      });
      return {
        ...message,
        replies: message.replies.map(({ authorId, ...reply }) => ({ ...reply, mine: authorId === auth.userId })),
        readAt,
        acknowledgedAt: recipient.acknowledgedAt,
      };
    });
  }

  async acknowledge(auth: AuthContext, id: string, client: ClientInfo) {
    requireSchool(auth);
    const context = toTenantContext(auth);
    const result = await this.tenancy.run(context, async (tx) => {
      const recipient = await tx.messageRecipient.findFirst({
        where: { messageId: id, userId: auth.userId },
        select: { id: true, acknowledgedAt: true, readAt: true, message: { select: { requiresAck: true } } },
      });
      if (!recipient) throw new NotFoundException("Message introuvable.");
      if (!recipient.message.requiresAck) throw new BadRequestException("Ce message ne demande pas d'accusé de réception.");
      if (recipient.acknowledgedAt) return { acknowledgedAt: recipient.acknowledgedAt, already: true };
      const now = new Date();
      await tx.messageRecipient.update({
        where: { id: recipient.id },
        data: { acknowledgedAt: now, readAt: recipient.readAt ?? now },
      });
      return { acknowledgedAt: now, already: false };
    });
    if (!result.already) {
      await this.audit.scoped(context, { action: "message.acknowledged", entity: "Message", entityId: id, ...client });
    }
    return { acknowledgedAt: result.acknowledgedAt };
  }

  async replyAsParent(auth: AuthContext, id: string, dto: ReplyDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const reply = await this.tenancy.run(context, async (tx) => {
      const recipient = await tx.messageRecipient.findFirst({
        where: { messageId: id, userId: auth.userId },
        select: { message: { select: { kind: true, authorId: true, title: true } } },
      });
      if (!recipient) throw new NotFoundException("Message introuvable.");
      if (recipient.message.kind !== "direct") {
        throw new BadRequestException("Les réponses sont réservées aux échanges individuels.");
      }
      const created = await tx.messageReply.create({
        data: { schoolId, messageId: id, authorId: auth.userId, authorRole: auth.role, body: dto.body.trim() },
        select: { id: true, body: true, authorRole: true, createdAt: true },
      });
      await this.dispatcher.dispatch(tx, schoolId, [recipient.message.authorId], {
        kind: "message.reply",
        title: `Réponse d'une famille : ${recipient.message.title}`,
        body: dto.body.trim().slice(0, 200),
        link: `/messages/${id}`,
      });
      return created;
    });
    await this.audit.scoped(context, { action: "message.replied", entity: "Message", entityId: id, ...client });
    return reply;
  }
}
