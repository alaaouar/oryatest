import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ScanResult } from "../storage/antivirus";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { NotificationDispatcher } from "../channels/channels";
import { schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import { civilDate } from "../parent-space/common";
import { StorageService, type StoredScan, type ValidatedUpload } from "../storage/storage.service";
import type { MulterFile } from "../parent-space/justifications.service";
import type { AgendaRangeQueryDto, CreateAgendaItemDto, UpdateAgendaItemDto } from "./agenda.dto";
import { retentionUntil } from "../storage/retention";

type Tx = Prisma.TransactionClient;

const MAX_ATTACHMENTS = 3;
const DEFAULT_WINDOW_DAYS = 60;

const ITEM_SELECT = {
  id: true,
  kind: true,
  title: true,
  description: true,
  date: true,
  schoolYear: true,
  authorId: true,
  authorRole: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  classroom: { select: { id: true, name: true } },
  attachments: {
    orderBy: { createdAt: "asc" },
    select: { id: true, file: { select: { originalName: true, mimeType: true, sizeBytes: true } } },
  },
} satisfies Prisma.AgendaItemSelect;

type ItemRow = Prisma.AgendaItemGetPayload<{ select: typeof ITEM_SELECT }>;

function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) throw new ForbiddenException("Un établissement actif est requis.");
  return auth.schoolId;
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toView(row: ItemRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    date: day(row.date),
    classroom: row.classroom,
    authorRole: row.authorRole,
    cancelled: !!row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    attachments: row.attachments.map((entry) => ({
      id: entry.id,
      name: entry.file.originalName,
      mimeType: entry.file.mimeType,
      sizeBytes: entry.file.sizeBytes,
    })),
  };
}

/**
 * Agenda et devoirs (lot 6). Écriture : direction (MFA) ou enseignant affecté
 * à la classe. Lecture parent : classes de ses enfants + dates d'école.
 * Les événements d'école restent ceux du lot 5 (Message kind=event) : ils sont
 * fusionnés à la lecture, jamais recopiés.
 */
@Injectable()
export class AgendaService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  private range(query: AgendaRangeQueryDto) {
    const from = query.from ? civilDate(query.from, "Date de début") : new Date(Date.now() - 7 * 86_400_000);
    const to = query.to
      ? civilDate(query.to, "Date de fin")
      : new Date(from.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);
    if (to < from) throw new BadRequestException("La date de fin précède la date de début.");
    if ((to.getTime() - from.getTime()) / 86_400_000 > 370) throw new BadRequestException("Période limitée à un an.");
    return { from: new Date(day(from) + "T00:00:00.000Z"), to: new Date(day(to) + "T23:59:59.999Z") };
  }

  private async teacherClassrooms(tx: Tx, auth: AuthContext): Promise<Set<string>> {
    const rows = await tx.teacherClassroomAssignment.findMany({
      where: { teacherProfileId: auth.profileId, schoolYear: schoolYearForDate(new Date()) },
      select: { classroomId: true },
    });
    return new Set(rows.map((row) => row.classroomId));
  }

  private async childClassrooms(tx: Tx, auth: AuthContext): Promise<string[]> {
    const rows = await tx.enrollment.findMany({
      where: {
        schoolYear: schoolYearForDate(new Date()),
        student: { guardians: { some: { guardian: { userId: auth.userId } } } },
      },
      select: { classroomId: true },
    });
    return [...new Set(rows.map((row) => row.classroomId))];
  }

  private assertDirectionMfa(auth: AuthContext) {
    if (auth.role === "direction" && !auth.mfa) {
      throw new ForbiddenException("Authentification renforcée requise pour cette action.");
    }
  }

  /** Droit d'écriture sur une entrée existante ou une classe cible. */
  private async assertCanWrite(tx: Tx, auth: AuthContext, classroomId: string | null) {
    if (auth.role === "direction") return;
    if (!classroomId) throw new ForbiddenException("Seule la direction publie les dates de toute l'école.");
    const mine = await this.teacherClassrooms(tx, auth);
    if (!mine.has(classroomId)) throw new ForbiddenException("Cette classe ne vous est pas affectée.");
  }

  /**
   * Bloc 3b : meme pipeline que les justificatifs. Pour CHAQUE fichier : taille,
   * antivirus avant tout controle de type, magic bytes, puis ecriture chiffree.
   * Un seul fichier infecte => 422, audit, et rien n'est conserve.
   */
  private async storeAttachments(auth: AuthContext, schoolId: string, files: MulterFile[], client: ClientInfo) {
    const accepted: { upload: ValidatedUpload; scan: ScanResult }[] = [];
    for (const file of files) {
      const result = await this.storage.intake(file.originalname, file.buffer);
      if ("infected" in result) {
        await this.audit.scoped(toTenantContext(auth), {
          action: "file.rejected.infected",
          entity: "School",
          entityId: schoolId,
          severity: "warning",
          metadata: { purpose: "agenda", signature: result.infected.signature ?? "inconnue", sha256: result.sha256 },
          ...client,
        });
        throw new UnprocessableEntityException("Fichier refuse : contenu malveillant detecte par l'antivirus.");
      }
      accepted.push({ upload: result.upload, scan: result.scan });
    }
    const stored: { upload: ValidatedUpload; key: string; scan: StoredScan }[] = [];
    try {
      for (const entry of accepted) {
        const s = await this.storage.store(schoolId, entry.upload, entry.scan);
        stored.push({ upload: entry.upload, key: s.key, scan: s });
      }
    } catch (error) {
      for (const entry of stored) await this.storage.removeQuietly(entry.key);
      throw error;
    }
    return stored;
  }

  private async attach(
    tx: Tx,
    auth: AuthContext,
    schoolId: string,
    itemId: string,
    stored: { upload: ValidatedUpload; key: string; scan: StoredScan }[],
  ) {
    for (const { upload, key, scan } of stored) {
      const file = await tx.storedFile.create({
        data: {
          schoolId,
          driver: this.storage.driverName,
          encryption: scan.encryption,
          storageKey: key,
          mimeType: upload.mimeType,
          sizeBytes: upload.sizeBytes,
          sha256: upload.sha256,
          originalName: upload.originalName,
          createdById: auth.userId,
          scanStatus: scan.scanStatus,
          scannedAt: scan.scannedAt,
          scanEngine: scan.scanEngine,
          // t50u : conservation PROVISOIRE (365 j, juriste), purge par FileRetentionService.
          retentionUntil: retentionUntil("agenda"),
          purpose: "agenda",
        },
        select: { id: true },
      });
      await tx.agendaAttachment.create({ data: { schoolId, agendaItemId: itemId, fileId: file.id } });
    }
  }

  async create(auth: AuthContext, dto: CreateAgendaItemDto, client: ClientInfo, files: MulterFile[] = []) {
    const schoolId = requireSchool(auth);
    this.assertDirectionMfa(auth);
    const context = toTenantContext(auth);
    const date = civilDate(dto.date, "Date");
    if (!dto.classroomId && dto.kind !== "important_date") {
      throw new BadRequestException("Une classe est requise pour ce type d'entrée.");
    }

    // Contrôles d'accès avant toute écriture de fichier.
    await this.tenancy.run(context, async (tx) => {
      if (dto.classroomId) {
        const classroom = await tx.classroom.findFirst({ where: { id: dto.classroomId }, select: { id: true } });
        if (!classroom) throw new NotFoundException("Classe introuvable.");
      }
      await this.assertCanWrite(tx, auth, dto.classroomId ?? null);
    });

    const stored = await this.storeAttachments(auth, schoolId, files, client);
    let result;
    try {
      result = await this.tenancy.run(context, async (tx) => {
        const item = await tx.agendaItem.create({
          data: {
            schoolId,
            classroomId: dto.classroomId ?? null,
            kind: dto.kind,
            title: dto.title.trim(),
            description: dto.description?.trim() || null,
            date,
            schoolYear: schoolYearForDate(date),
            authorId: auth.userId,
            authorRole: auth.role,
          },
          select: { id: true },
        });
        await this.attach(tx, auth, schoolId, item.id, stored);

        // Notification in-app aux parents concernés (devoirs et contrôles).
        let notified = 0;
        if (dto.classroomId && (dto.kind === "homework" || dto.kind === "test")) {
          const links = await tx.studentGuardian.findMany({
            where: {
              guardian: { userId: { not: null } },
              student: { enrollments: { some: { classroomId: dto.classroomId, schoolYear: schoolYearForDate(new Date()) } } },
            },
            select: { guardian: { select: { userId: true } } },
          });
          const userIds = [...new Set(links.map((link) => link.guardian.userId!).filter(Boolean))];
          const reports = await this.dispatcher.dispatch(tx, schoolId, userIds, {
            kind: dto.kind === "homework" ? "agenda.homework" : "agenda.test",
            title: `${dto.kind === "homework" ? "Nouveau devoir" : "Contrôle prévu"} : ${dto.title.trim()}`,
            body: `Pour le ${dto.date.split("-").reverse().join("/")}`,
            link: `/family/agenda/${item.id}`,
          });
          notified = reports.find((entry) => entry.channel === "in_app")?.delivered ?? 0;
        }
        const row = await tx.agendaItem.findFirstOrThrow({ where: { id: item.id }, select: ITEM_SELECT });
        return { row, notified };
      });
    } catch (error) {
      for (const entry of stored) await this.storage.removeQuietly(entry.key);
      throw error;
    }

    await this.audit.scoped(context, {
      action: "agenda.created",
      entity: "AgendaItem",
      entityId: result.row.id,
      metadata: { kind: dto.kind, classroomId: dto.classroomId ?? null, date: dto.date, attachments: stored.length },
      ...client,
    });
    return { ...toView(result.row), notified: result.notified };
  }

  async update(auth: AuthContext, id: string, dto: UpdateAgendaItemDto, client: ClientInfo) {
    requireSchool(auth);
    this.assertDirectionMfa(auth);
    const context = toTenantContext(auth);
    const { row, changes } = await this.tenancy.run(context, async (tx) => {
      const current = await tx.agendaItem.findFirst({ where: { id }, select: ITEM_SELECT });
      if (!current) throw new NotFoundException("Entrée introuvable.");
      if (current.cancelledAt) throw new ConflictException("Cette entrée est annulée.");
      await this.assertCanWrite(tx, auth, current.classroom?.id ?? null);
      const data: Prisma.AgendaItemUpdateInput = {};
      const diff: Record<string, { from: string | null; to: string | null }> = {};
      if (dto.title !== undefined && dto.title.trim() !== current.title) {
        data.title = dto.title.trim();
        diff.title = { from: current.title, to: dto.title.trim() };
      }
      if (dto.description !== undefined && (dto.description.trim() || null) !== current.description) {
        data.description = dto.description.trim() || null;
        diff.description = { from: current.description, to: dto.description.trim() || null };
      }
      if (dto.date !== undefined && dto.date !== day(current.date)) {
        data.date = civilDate(dto.date, "Date");
        diff.date = { from: day(current.date), to: dto.date };
      }
      if (Object.keys(diff).length === 0) return { row: current, changes: diff };
      const updated = await tx.agendaItem.update({ where: { id }, data, select: ITEM_SELECT });
      return { row: updated, changes: diff };
    });
    if (Object.keys(changes).length > 0) {
      await this.audit.scoped(context, {
        action: "agenda.updated",
        entity: "AgendaItem",
        entityId: id,
        metadata: { changes },
        ...client,
      });
    }
    return toView(row);
  }

  async cancel(auth: AuthContext, id: string, client: ClientInfo) {
    requireSchool(auth);
    this.assertDirectionMfa(auth);
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, async (tx) => {
      const current = await tx.agendaItem.findFirst({ where: { id }, select: { cancelledAt: true, classroomId: true } });
      if (!current) throw new NotFoundException("Entrée introuvable.");
      if (current.cancelledAt) throw new ConflictException("Cette entrée est déjà annulée.");
      await this.assertCanWrite(tx, auth, current.classroomId);
      return tx.agendaItem.update({ where: { id }, data: { cancelledAt: new Date() }, select: ITEM_SELECT });
    });
    await this.audit.scoped(context, { action: "agenda.cancelled", entity: "AgendaItem", entityId: id, severity: "warning", ...client });
    return toView(row);
  }

  async addAttachment(auth: AuthContext, id: string, file: MulterFile | undefined, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    if (!file) throw new BadRequestException("Fichier requis (multipart, champ file).");
    this.assertDirectionMfa(auth);
    const context = toTenantContext(auth);
    await this.tenancy.run(context, async (tx) => {
      const current = await tx.agendaItem.findFirst({
        where: { id },
        select: { classroomId: true, cancelledAt: true, _count: { select: { attachments: true } } },
      });
      if (!current) throw new NotFoundException("Entrée introuvable.");
      if (current.cancelledAt) throw new ConflictException("Cette entrée est annulée.");
      await this.assertCanWrite(tx, auth, current.classroomId);
      if (current._count.attachments >= MAX_ATTACHMENTS) throw new ConflictException("Trois pièces jointes au maximum.");
    });
    const stored = await this.storeAttachments(auth, schoolId, [file], client);
    let row;
    try {
      row = await this.tenancy.run(context, async (tx) => {
        await this.attach(tx, auth, schoolId, id, stored);
        return tx.agendaItem.findFirstOrThrow({ where: { id }, select: ITEM_SELECT });
      });
    } catch (error) {
      for (const entry of stored) await this.storage.removeQuietly(entry.key);
      throw error;
    }
    await this.audit.scoped(context, {
      action: "agenda.attachment.added",
      entity: "AgendaItem",
      entityId: id,
      metadata: { name: stored[0]?.upload.originalName ?? null },
      ...client,
    });
    return toView(row);
  }

  /** Événements d'école du lot 5, lus sans copie. */
  private async schoolEvents(tx: Tx, auth: AuthContext, from: Date, to: Date, classroomIds: string[] | null) {
    const where: Prisma.MessageWhereInput = { kind: "event", eventAt: { gte: from, lte: to } };
    if (auth.role === "parent") {
      where.recipients = { some: { userId: auth.userId } };
    } else if (classroomIds) {
      where.OR = [{ audience: "school" }, { classroomId: { in: classroomIds } }];
    }
    const events = await tx.message.findMany({
      where,
      orderBy: { eventAt: "asc" },
      take: 200,
      select: { id: true, title: true, eventAt: true, eventLocation: true, classroom: { select: { id: true, name: true } } },
    });
    return events.map((event) => ({
      id: event.id,
      title: event.title,
      at: event.eventAt,
      location: event.eventLocation,
      classroom: event.classroom,
    }));
  }

  async listForStaff(auth: AuthContext, query: AgendaRangeQueryDto) {
    requireSchool(auth);
    const { from, to } = this.range(query);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const scope = auth.role === "teacher" ? [...(await this.teacherClassrooms(tx, auth))] : null;
      if (query.classroomId && scope && !scope.includes(query.classroomId)) {
        throw new ForbiddenException("Cette classe ne vous est pas affectée.");
      }
      const classFilter = query.classroomId ? [query.classroomId] : scope;
      const items = await tx.agendaItem.findMany({
        where: {
          date: { gte: from, lte: to },
          ...(query.kind ? { kind: query.kind } : {}),
          ...(classFilter ? { OR: [{ classroomId: null }, { classroomId: { in: classFilter } }] } : {}),
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        take: 500,
        select: ITEM_SELECT,
      });
      return {
        from: day(from),
        to: day(to),
        items: items.map(toView),
        events: query.kind ? [] : await this.schoolEvents(tx, auth, from, to, classFilter),
      };
    });
  }

  async listForParent(auth: AuthContext, query: AgendaRangeQueryDto) {
    requireSchool(auth);
    const { from, to } = this.range(query);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const classes = await this.childClassrooms(tx, auth);
      const items = await tx.agendaItem.findMany({
        where: {
          date: { gte: from, lte: to },
          cancelledAt: null,
          ...(query.kind ? { kind: query.kind } : {}),
          OR: [{ classroomId: null }, { classroomId: { in: classes } }],
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        take: 500,
        select: ITEM_SELECT,
      });
      return {
        from: day(from),
        to: day(to),
        items: items.map(toView),
        events: query.kind ? [] : await this.schoolEvents(tx, auth, from, to, null),
      };
    });
  }

  /** Entrée visible par le compte, sinon 404 (pas d'oracle d'existence). */
  private async visibleItem(tx: Tx, auth: AuthContext, id: string) {
    let where: Prisma.AgendaItemWhereInput = { id };
    if (auth.role === "parent") {
      const classes = await this.childClassrooms(tx, auth);
      where = { id, cancelledAt: null, OR: [{ classroomId: null }, { classroomId: { in: classes } }] };
    } else if (auth.role === "teacher") {
      const classes = [...(await this.teacherClassrooms(tx, auth))];
      where = { id, OR: [{ classroomId: null }, { classroomId: { in: classes } }] };
    }
    const row = await tx.agendaItem.findFirst({ where, select: ITEM_SELECT });
    if (!row) throw new NotFoundException("Entrée introuvable.");
    return row;
  }

  async detail(auth: AuthContext, id: string) {
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const row = await this.visibleItem(tx, auth, id);
      const view = toView(row);
      if (auth.role === "parent") return view;
      const history = await tx.auditLog.findMany({
        where: { entity: "AgendaItem", entityId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, action: true, metadata: true, createdAt: true, actorId: true },
      });
      const actors = await tx.userProfile.findMany({
        where: { userId: { in: history.map((entry) => entry.actorId).filter((value): value is string => !!value) } },
        select: { userId: true, displayName: true, role: true },
      });
      const actorMap = new Map(actors.map((actor) => [actor.userId, actor]));
      return {
        ...view,
        canEdit: auth.role === "direction" || (auth.role === "teacher" && !!row.classroom),
        history: history.map((entry) => {
          const actor = entry.actorId ? actorMap.get(entry.actorId) : undefined;
          return {
            id: entry.id,
            action: entry.action,
            metadata: entry.metadata,
            createdAt: entry.createdAt,
            actor: actor ? { displayName: actor.displayName, role: actor.role } : null,
          };
        }),
      };
    });
  }

  async attachmentFile(auth: AuthContext, id: string, attachmentId: string) {
    requireSchool(auth);
    const file = await this.tenancy.run(toTenantContext(auth), async (tx) => {
      await this.visibleItem(tx, auth, id);
      const attachment = await tx.agendaAttachment.findFirst({
        where: { id: attachmentId, agendaItemId: id },
        select: {
          file: { select: { storageKey: true, mimeType: true, sizeBytes: true, originalName: true, scanStatus: true, purgedAt: true } },
        },
      });
      if (!attachment) throw new NotFoundException("Fichier introuvable.");
      return attachment.file;
    });
    // Bloc 3b : telechargeable seulement si l'antivirus a conclu "clean" (409 sinon).
    return this.storage.downloadFor(file);
  }
}
