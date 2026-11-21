import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { TenancyService } from "../core/tenancy.service";
import { StorageService, type ValidatedUpload } from "../storage/storage.service";
import { retentionUntil } from "../storage/retention";
import { schoolYearForDate } from "../core/school-year";
import { civilDate, ownChild, requireSchool } from "./common";
import { NotificationsService } from "./notifications.service";
import type {
  CompleteJustificationDto,
  ListJustificationsQueryDto,
  ReviewJustificationDto,
  SubmitJustificationDto,
} from "./parent-space.dto";

const MAX_RANGE_DAYS = 31;

/**
 * Decision t50u (parametre nomme et inversable, question au juriste) : le co-responsable
 * d'un meme enfant voit le STATUT des justificatifs deposes par l'autre responsable
 * (dates + statut), jamais le motif, la piece, la note ni l'auteur.
 * JUSTIFICATION_COGUARDIAN_STATUS=1 (defaut) | 0 (le co-responsable ne voit rien, regle t49u).
 */
export function coGuardianStatusVisible(): boolean {
  const raw = (process.env.JUSTIFICATION_COGUARDIAN_STATUS ?? "1").trim().toLowerCase();
  return !(raw === "0" || raw === "false");
}

const JUSTIFICATION_SELECT = {
  id: true,
  fromDate: true,
  toDate: true,
  reason: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
  submittedById: true,
  student: { select: { id: true, displayName: true, studentCode: true } },
  file: { select: { id: true, mimeType: true, sizeBytes: true, originalName: true, scanStatus: true, purgedAt: true } },
} satisfies Prisma.AbsenceJustificationSelect;

/** Fichier recu par multer (memoire). Le MIME declare n'est jamais utilise. */
export type MulterFile = { originalname: string; buffer: Buffer; size: number; mimetype: string };

/**
 * Justificatifs d'absence (CDC lot 4). Le parent dépose pour ses enfants ;
 * la direction accepte ou refuse, avec audit et notification au parent.
 */
@Injectable()
export class JustificationsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async submit(auth: AuthContext, dto: SubmitJustificationDto, client: ClientInfo, multipart?: MulterFile) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const from = civilDate(dto.fromDate, "Date de début");
    const to = civilDate(dto.toDate, "Date de fin");
    if (to < from) throw new BadRequestException("La date de fin précède la date de début.");
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Période limitée à ${MAX_RANGE_DAYS} jours.`);
    }
    // Bloc 3b : envoi multipart uniquement (la voie base64 JSON est supprimee).
    const incoming: { name: string; content: Buffer } | null = multipart
      ? { name: multipart.originalname, content: multipart.buffer }
      : null;

    const student = await this.tenancy.run(context, (tx) =>
      tx.student.findFirst({ where: { id: dto.studentId, ...ownChild(auth) }, select: { id: true } }),
    );
    if (!student) throw new NotFoundException("Enfant introuvable.");

    // Antivirus AVANT tout controle de type et toute ecriture : infecte => 422, rien n'est stocke.
    let stored = null;
    let upload: ValidatedUpload | null = null;
    if (incoming) {
      const result = await this.storage.intake(incoming.name, incoming.content);
      if ("infected" in result) {
        await this.audit.scoped(context, {
          action: "file.rejected.infected",
          entity: "Student",
          entityId: student.id,
          severity: "warning",
          metadata: { purpose: "justification", signature: result.infected.signature ?? "inconnue", sha256: result.sha256 },
          ...client,
        });
        throw new UnprocessableEntityException("Fichier refuse : contenu malveillant detecte par l'antivirus.");
      }
      upload = result.upload;
      stored = await this.storage.store(schoolId, upload, result.scan);
    }
    const key = stored?.key ?? null;
    let created;
    try {
      created = await this.tenancy.run(context, async (tx) => {
        const file =
          upload && key
            ? await tx.storedFile.create({
                data: {
                  schoolId,
                  driver: this.storage.driverName,
                  storageKey: key,
                  mimeType: upload.mimeType,
                  sizeBytes: upload.sizeBytes,
                  sha256: upload.sha256,
                  originalName: upload.originalName,
                  createdById: auth.userId,
                  scanStatus: stored!.scanStatus,
                  scannedAt: stored!.scannedAt,
                  scanEngine: stored!.scanEngine,
                  encryption: stored!.encryption,
                  purpose: "justification",
                  retentionUntil: retentionUntil("justification"),
                },
                select: { id: true },
              })
            : null;
        return tx.absenceJustification.create({
          data: {
            schoolId,
            studentId: student.id,
            fromDate: from,
            toDate: to,
            reason: dto.reason.trim(),
            fileId: file?.id ?? null,
            submittedById: auth.userId,
          },
          select: JUSTIFICATION_SELECT,
        });
      });
    } catch (error) {
      if (key) await this.storage.removeQuietly(key);
      throw error;
    }

    await this.audit.scoped(context, {
      action: "student.justification.submitted",
      entity: "Student",
      entityId: student.id,
      metadata: {
        justificationId: created.id,
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        hasFile: !!upload,
        scanStatus: stored?.scanStatus ?? null,
      },
      ...client,
    });
    return toParentView(created);
  }

  async listForParent(auth: AuthContext) {
    requireSchool(auth);
    const rows = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.absenceJustification.findMany({
        // Decision t49u : un parent ne voit QUE ses propres envois (motif et piece
        // compris) ; un autre parent, meme du meme enfant, ne voit rien.
        where: { student: ownChild(auth), submittedById: auth.userId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: JUSTIFICATION_SELECT,
      }),
    );
    return rows.map(toParentView);
  }

  /** Statut seul des envois du co-responsable (voir coGuardianStatusVisible). */
  async coGuardianStatusesForParent(auth: AuthContext) {
    requireSchool(auth);
    if (!coGuardianStatusVisible()) return [];
    const rows = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.absenceJustification.findMany({
        where: { student: ownChild(auth), submittedById: { not: auth.userId } },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, fromDate: true, toDate: true, status: true, student: { select: { id: true, displayName: true } } },
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      student: r.student,
      fromDate: r.fromDate.toISOString().slice(0, 10),
      toDate: r.toDate.toISOString().slice(0, 10),
      status: r.status,
    }));
  }

  async listForSchool(auth: AuthContext, query: ListJustificationsQueryDto) {
    requireSchool(auth);
    const rows = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.absenceJustification.findMany({
        where: query.status ? { status: query.status } : {},
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 200,
        select: JUSTIFICATION_SELECT,
      }),
    );
    return rows.map(toView);
  }

  async review(auth: AuthContext, id: string, dto: ReviewJustificationDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const note = dto.note?.trim() || null;
    if (dto.decision === "rejected" && !note) {
      throw new BadRequestException("Indiquez le motif du refus pour la famille.");
    }
    if (dto.decision === "incomplete" && !note) {
      throw new BadRequestException("Indiquez à la famille ce qu'il faut compléter.");
    }

    const updated = await this.tenancy.run(context, async (tx) => {
      const current = await tx.absenceJustification.findFirst({ where: { id }, select: { id: true, status: true } });
      if (!current) throw new NotFoundException("Justificatif introuvable.");
      if (current.status !== "pending") throw new ConflictException("Ce justificatif a déjà été examiné.");
      const row = await tx.absenceJustification.update({
        where: { id },
        data: { status: dto.decision, reviewNote: note, reviewedById: auth.userId, reviewedAt: new Date() },
        select: JUSTIFICATION_SELECT,
      });
      if (dto.decision === "incomplete") {
        // t92 M4 : carte « À faire » liée, fermée automatiquement quand la famille complète.
        await tx.parentAction.create({
          data: {
            schoolId,
            studentId: row.student.id,
            title: `Compléter le justificatif du ${frDate(row.fromDate)}`,
            description: note,
            createdById: auth.userId,
            justificationId: row.id,
          },
          select: { id: true },
        });
      }
      await this.notifications.notifyUsers(tx, schoolId, [row.submittedById], {
        kind: `justification.${dto.decision}`,
        title:
          dto.decision === "accepted"
            ? `Justificatif accepté pour ${row.student.displayName}`
            : dto.decision === "incomplete"
              ? `Justificatif à compléter pour ${row.student.displayName}`
              : `Justificatif refusé pour ${row.student.displayName}`,
        body: note ?? undefined,
        link: "/family",
      });
      return row;
    });

    await this.audit.scoped(context, {
      action: `student.justification.${dto.decision}`,
      entity: "Student",
      entityId: updated.student.id,
      severity: dto.decision === "rejected" ? "warning" : "info",
      metadata: { justificationId: id, note },
      ...client,
    });
    return toView(updated);
  }

  /**
   * t92 M4 : la famille (le parent auteur uniquement) complète un justificatif « à compléter »
   * par une précision de motif et/ou une nouvelle pièce (pipeline antivirus complet). Le
   * justificatif repasse « en attente » et la carte « À faire » liée est fermée.
   */
  async complete(auth: AuthContext, id: string, dto: CompleteJustificationDto, client: ClientInfo, multipart?: MulterFile) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const reason = dto.reason?.trim() || null;
    if (!reason && !multipart) {
      throw new BadRequestException("Ajoutez une précision ou une pièce pour compléter le justificatif.");
    }
    const current = await this.tenancy.run(context, (tx) =>
      tx.absenceJustification.findFirst({
        where: { id, student: ownChild(auth), submittedById: auth.userId },
        select: { id: true, status: true, studentId: true },
      }),
    );
    if (!current) throw new NotFoundException("Justificatif introuvable.");
    if (current.status !== "incomplete") throw new ConflictException("Ce justificatif n'attend pas de complément.");

    const ingested = multipart ? await this.ingestFile(context, schoolId, current.studentId, multipart, client) : null;
    let updated;
    try {
      updated = await this.tenancy.run(context, async (tx) => {
        const file = ingested
          ? await tx.storedFile.create({
              data: {
                schoolId,
                driver: this.storage.driverName,
                storageKey: ingested.key,
                mimeType: ingested.upload.mimeType,
                sizeBytes: ingested.upload.sizeBytes,
                sha256: ingested.upload.sha256,
                originalName: ingested.upload.originalName,
                createdById: auth.userId,
                scanStatus: ingested.stored.scanStatus,
                scannedAt: ingested.stored.scannedAt,
                scanEngine: ingested.stored.scanEngine,
                encryption: ingested.stored.encryption,
                purpose: "justification",
                retentionUntil: retentionUntil("justification"),
              },
              select: { id: true },
            })
          : null;
        const res = await tx.absenceJustification.updateMany({
          where: { id, status: "incomplete", submittedById: auth.userId },
          data: { status: "pending", ...(reason ? { reason } : {}), ...(file ? { fileId: file.id } : {}) },
        });
        if (res.count !== 1) throw new ConflictException("Ce justificatif n'attend pas de complément.");
        await tx.parentAction.updateMany({
          where: { justificationId: id, status: "open" },
          data: { status: "done", completedById: auth.userId, completedAt: new Date() },
        });
        return tx.absenceJustification.findFirstOrThrow({ where: { id }, select: JUSTIFICATION_SELECT });
      });
    } catch (error) {
      if (ingested) await this.storage.removeQuietly(ingested.key);
      throw error;
    }

    await this.audit.scoped(context, {
      action: "student.justification.completed",
      entity: "Student",
      entityId: current.studentId,
      metadata: { justificationId: id, reasonUpdated: !!reason, hasFile: !!ingested, scanStatus: ingested?.stored.scanStatus ?? null },
      ...client,
    });
    return toParentView(updated);
  }

  /** Antivirus AVANT tout controle de type et toute ecriture (meme pipeline que submit). */
  private async ingestFile(
    context: ReturnType<typeof toTenantContext>,
    schoolId: string,
    studentId: string,
    multipart: MulterFile,
    client: ClientInfo,
  ) {
    const result = await this.storage.intake(multipart.originalname, multipart.buffer);
    if ("infected" in result) {
      await this.audit.scoped(context, {
        action: "file.rejected.infected",
        entity: "Student",
        entityId: studentId,
        severity: "warning",
        metadata: { purpose: "justification", signature: result.infected.signature ?? "inconnue", sha256: result.sha256 },
        ...client,
      });
      throw new UnprocessableEntityException("Fichier refuse : contenu malveillant detecte par l'antivirus.");
    }
    const upload = result.upload;
    const stored = await this.storage.store(schoolId, upload, result.scan);
    return { upload, stored, key: stored.key };
  }

  /**
   * Piece d'un justificatif (decision t49u) : administration de l'ecole, ou le
   * parent qui l'a deposee (sa donnee). Autre parent : 404 (pas d'indice
   * d'existence). Enseignant, eleve : 403 (statut seulement). Telechargeable
   * seulement si l'antivirus a conclu "clean" (409) et avant la purge (410).
   */
  async fileFor(auth: AuthContext, id: string) {
    requireSchool(auth);
    if (auth.role !== "direction" && auth.role !== "parent") {
      throw new ForbiddenException("Piece reservee a l'administration et au parent auteur.");
    }
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, (tx) =>
      tx.absenceJustification.findFirst({
        where: auth.role === "parent" ? { id, submittedById: auth.userId, student: ownChild(auth) } : { id },
        select: {
          student: { select: { id: true } },
          file: { select: { id: true, storageKey: true, mimeType: true, sizeBytes: true, originalName: true, scanStatus: true, purgedAt: true } },
        },
      }),
    );
    if (!row?.file) throw new NotFoundException("Fichier introuvable.");
    const target = await this.storage.downloadFor(row.file);
    await this.audit.scoped(context, {
      action: "file.download.issued",
      entity: "StoredFile",
      entityId: row.file.id,
      metadata: { purpose: "justification", studentId: row.student.id, kind: target.kind, by: auth.role },
    });
    return target;
  }

  /**
   * Enseignant : statut seulement (ni motif, ni piece, ni note) pour les eleves
   * de ses classes de l'annee en cours.
   */
  async statusForTeacher(auth: AuthContext, studentId: string) {
    requireSchool(auth);
    if (auth.role !== "teacher") throw new ForbiddenException();
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const year = schoolYearForDate(new Date());
      const visible = await tx.enrollment.findFirst({
        where: {
          studentId,
          schoolYear: year,
          classroom: { assignments: { some: { teacherProfileId: auth.profileId, schoolYear: year } } },
        },
        select: { id: true },
      });
      if (!visible) throw new NotFoundException("Eleve introuvable.");
      return statusOnly(tx, studentId);
    });
  }
}

/** Vue "statut seulement" (enseignant, eleve) : aucune donnee du parent. */
export async function statusOnly(tx: Prisma.TransactionClient, studentId: string) {
  const rows = await tx.absenceJustification.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, fromDate: true, toDate: true, status: true },
  });
  return rows.map((r) => ({
    id: r.id,
    fromDate: r.fromDate.toISOString().slice(0, 10),
    toDate: r.toDate.toISOString().slice(0, 10),
    status: r.status,
  }));
}

type Row = Prisma.AbsenceJustificationGetPayload<{ select: typeof JUSTIFICATION_SELECT }>;

/**
 * Vue famille (decision t49u) : le parent auteur voit son motif et sa piece.
 * N'est appelee que sur ses propres envois (filtre submittedById).
 */
/** Date civile JJ/MM/AAAA (libellé de carte). */
function frDate(d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

function toParentView(row: Row) {
  return toView(row);
}

function toView(row: Row) {
  return {
    id: row.id,
    student: row.student,
    fromDate: row.fromDate.toISOString().slice(0, 10),
    toDate: row.toDate.toISOString().slice(0, 10),
    reason: row.reason,
    status: row.status,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    file: row.file
      ? {
          mimeType: row.file.mimeType,
          sizeBytes: row.file.sizeBytes,
          name: row.file.originalName,
          scanStatus: row.file.scanStatus,
          purged: !!row.file.purgedAt,
        }
      : null,
  };
}
