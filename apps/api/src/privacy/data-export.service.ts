import { ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { TenancyService, type TenantContext } from "../core/tenancy.service";
import { busHistory } from "../bus/bus.service";
import { statusOnly } from "../parent-space/justifications.service";
import { StorageService } from "../storage/storage.service";
import { renderTextPdf } from "./pdf";

type Tx = Prisma.TransactionClient;

export const EXPORT_TTL_DAYS = 7;

const VIEW_SELECT = {
  id: true,
  status: true,
  requestedAt: true,
  readyAt: true,
  expiresAt: true,
} as const;

/**
 * Bloc 4 : droit d'acces. Export asynchrone (JSON + PDF) des donnees DU SEUL
 * demandeur : aucune piece jointe (ni la sienne ni celle d'autrui, metadonnees
 * seulement), aucune donnee d'un autre parent. Fichiers analyses (antivirus),
 * stockes chiffres, servis par URL pre-signee courte, disponibles 7 jours puis purges.
 */
@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async request(auth: AuthContext, client: ClientInfo) {
    if (!auth.schoolId) throw new ForbiddenException("Un etablissement actif est requis.");
    const schoolId = auth.schoolId;
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, async (tx) => {
      const open = await tx.dataExportRequest.findFirst({
        where: { userId: auth.userId, status: { in: ["pending", "processing"] } },
        select: { id: true },
      });
      if (open) throw new ConflictException("Un export est deja en cours de preparation.");
      return tx.dataExportRequest.create({ data: { userId: auth.userId, schoolId }, select: VIEW_SELECT });
    });
    await this.audit.scoped(context, {
      action: "privacy.export.requested",
      entity: "DataExportRequest",
      entityId: row.id,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return toView(row);
  }

  list(auth: AuthContext) {
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const rows = await tx.dataExportRequest.findMany({
        where: { userId: auth.userId },
        orderBy: { requestedAt: "desc" },
        take: 20,
        select: VIEW_SELECT,
      });
      return { items: rows.map(toView) };
    });
  }

  async download(auth: AuthContext, id: string, format: "json" | "pdf", client: ClientInfo) {
    const context = toTenantContext(auth);
    const file = await this.tenancy.run(context, async (tx) => {
      const row = await tx.dataExportRequest.findFirst({
        where: { id, userId: auth.userId },
        select: {
          status: true,
          expiresAt: true,
          jsonFile: { select: FILE_SELECT },
          pdfFile: { select: FILE_SELECT },
        },
      });
      if (!row) throw new NotFoundException("Export introuvable.");
      if (row.status === "expired" || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
        throw new GoneException("Export expire (disponible 7 jours) : faites une nouvelle demande.");
      }
      if (row.status !== "ready") throw new ConflictException("Export en cours de preparation.");
      const target = format === "json" ? row.jsonFile : row.pdfFile;
      if (!target) throw new GoneException("Fichier d'export indisponible.");
      return target;
    });
    const result = await this.storage.downloadFor(file);
    await this.audit.scoped(context, {
      action: "privacy.export.downloaded",
      entity: "DataExportRequest",
      entityId: id,
      metadata: { format },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return result;
  }

  /** Point d'entree du job / CLI : traite les demandes en attente (contexte systeme pour la file seulement). */
  async processDue(limit = 10): Promise<{ processed: number; failed: number }> {
    const claimed = await this.tenancy.runSystem(async (tx) => {
      const due = await tx.dataExportRequest.findMany({
        where: { status: "pending" },
        orderBy: { requestedAt: "asc" },
        take: limit,
        select: { id: true, userId: true, schoolId: true },
      });
      const out: { id: string; userId: string; schoolId: string; profileId: string }[] = [];
      for (const row of due) {
        const took = await tx.dataExportRequest.updateMany({
          where: { id: row.id, status: "pending" },
          data: { status: "processing", startedAt: new Date() },
        });
        const profile = await tx.userProfile.findFirst({
          where: { userId: row.userId, schoolId: row.schoolId },
          select: { id: true },
        });
        if (took.count === 1 && profile) out.push({ ...row, profileId: profile.id });
        else if (took.count === 1) {
          await tx.dataExportRequest.update({ where: { id: row.id }, data: { status: "failed", error: "profil introuvable" } });
        }
      }
      return out;
    });

    let processed = 0;
    let failed = 0;
    for (const job of claimed) {
      // Construction dans le contexte RLS DU DEMANDEUR : il ne peut lire que ce que la base lui montre.
      const context: TenantContext = { userId: job.userId, profileId: job.profileId, schoolId: job.schoolId, isSuperAdmin: false };
      try {
        const data = await this.tenancy.run(context, (tx) => collect(tx, job.userId, job.profileId));
        const json = Buffer.from(JSON.stringify(data, null, 2), "utf8");
        const pdf = renderTextPdf("ORYA - export de vos donnees personnelles", toLines(data));
        const expiresAt = new Date(Date.now() + EXPORT_TTL_DAYS * 86_400_000);
        const storedJson = await this.storage.storeGenerated(job.schoolId, json, "application/json");
        const storedPdf = await this.storage.storeGenerated(job.schoolId, pdf, "application/pdf");
        await this.tenancy.run(context, async (tx) => {
          const mk = (s: typeof storedJson, mimeType: string, name: string) =>
            tx.storedFile.create({
              data: {
                schoolId: job.schoolId,
                driver: this.storage.driverName,
                storageKey: s.key,
                mimeType,
                sizeBytes: s.sizeBytes,
                sha256: s.sha256,
                originalName: name,
                createdById: job.userId,
                scanStatus: s.scanStatus,
                scannedAt: s.scannedAt,
                scanEngine: s.scanEngine,
                encryption: s.encryption,
                purpose: "data_export",
                retentionUntil: expiresAt,
              },
              select: { id: true },
            });
          const j = await mk(storedJson, "application/json", "orya-export.json");
          const p = await mk(storedPdf, "application/pdf", "orya-export.pdf");
          await tx.dataExportRequest.update({
            where: { id: job.id },
            data: { status: "ready", readyAt: new Date(), expiresAt, jsonFileId: j.id, pdfFileId: p.id },
          });
        });
        await this.audit.scoped(context, { action: "privacy.export.ready", entity: "DataExportRequest", entityId: job.id });
        processed += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message.slice(0, 200) : "erreur";
        this.logger.warn(`Export ${job.id} en echec : ${message}`);
        await this.tenancy.run(context, (tx) =>
          tx.dataExportRequest.update({ where: { id: job.id }, data: { status: "failed", error: message } }),
        ).catch(() => undefined);
      }
    }
    return { processed, failed };
  }

  /** Point d'entree du job / CLI : expiration a 7 jours, objets retires du stockage. */
  async purgeExpiredExports(now: Date = new Date()): Promise<{ expired: number }> {
    const due = await this.tenancy.runSystem((tx) =>
      tx.dataExportRequest.findMany({
        where: { status: "ready", expiresAt: { lte: now } },
        take: 500,
        select: {
          id: true,
          jsonFile: { select: { id: true, storageKey: true, purgedAt: true } },
          pdfFile: { select: { id: true, storageKey: true, purgedAt: true } },
        },
      }),
    );
    for (const row of due) {
      for (const file of [row.jsonFile, row.pdfFile]) {
        if (file && !file.purgedAt) {
          await this.storage.removeQuietly(file.storageKey);
          await this.tenancy.runSystem((tx) => tx.storedFile.update({ where: { id: file.id }, data: { purgedAt: now }, select: { id: true } }));
        }
      }
      await this.tenancy.runSystem((tx) =>
        tx.dataExportRequest.update({ where: { id: row.id }, data: { status: "expired" }, select: { id: true } }),
      );
    }
    return { expired: due.length };
  }
}

const FILE_SELECT = {
  storageKey: true,
  mimeType: true,
  sizeBytes: true,
  originalName: true,
  scanStatus: true,
  purgedAt: true,
} as const;

function toView(row: { id: string; status: string; requestedAt: Date; readyAt: Date | null; expiresAt: Date | null }) {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    readyAt: row.readyAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

const d = (v: Date | null | undefined) => (v ? v.toISOString() : null);
const day = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);

/** Donnees du seul demandeur. Pas de contenu de fichier ; pas de donnees d'un autre responsable. */
async function collect(tx: Tx, userId: string, profileId: string) {
  const user = await tx.user.findFirst({
    where: { id: userId },
    select: { id: true, email: true, locale: true, status: true, createdAt: true, lastLoginAt: true },
  });
  const profiles = await tx.userProfile.findMany({
    where: { userId },
    select: { id: true, role: true, displayName: true, schoolId: true, studentId: true, createdAt: true },
  });
  const profile = profiles.find((p) => p.id === profileId);
  const guardians = await tx.guardian.findMany({
    where: { userId },
    select: {
      fullName: true,
      email: true,
      phone: true,
      phoneSecondary: true,
      address: true,
      students: { select: { relationship: true, student: { select: { id: true, displayName: true } } } },
    },
  });
  const justifications = await tx.absenceJustification.findMany({
    where: { submittedById: userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fromDate: true,
      toDate: true,
      reason: true,
      status: true,
      createdAt: true,
      file: { select: { originalName: true, mimeType: true, sizeBytes: true } },
    },
  });
  const parentalConsents = await tx.parentalConsent.findMany({
    where: { userId },
    select: { id: true, purpose: true, channel: true, grantedAt: true, revokedAt: true, studentId: true },
  });
  const consents = await tx.consent.findMany({
    where: { userId },
    select: { scope: true, version: true, grantedAt: true, revokedAt: true },
  });
  const deletionRequests = await tx.accountDeletionRequest.findMany({
    where: { OR: [{ userId }, { requestedById: userId }] },
    select: { id: true, kind: true, status: true, requestedAt: true, effectiveAt: true, cancelledAt: true },
  });
  const rightsRequests = await tx.dataRightsRequest.findMany({
    where: { userId },
    select: { kind: true, subject: true, message: true, status: true, createdAt: true, handledAt: true, response: true },
  });
  const auditTrail = await tx.auditLog.findMany({
    where: { actorId: userId },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { action: true, entity: true, createdAt: true },
  });

  // t50u : donnees des enfants auxquelles le parent a droit (enfants lies a SES fiches
  // responsable) : presences et statut du bus. Jamais rien du co-responsable (ni ses
  // justificatifs, ni ses coordonnees, ni ses consentements) : seuls les justificatifs
  // deposes par le demandeur figurent dans `justifications`.
  const childIds = [...new Map(guardians.flatMap((g) => g.students.map((s) => [s.student.id, s.student.displayName] as const))).entries()];
  const childrenData = [];
  for (const [childId, displayName] of childIds) {
    const rows = await tx.attendanceRow.findMany({
      where: { studentId: childId },
      orderBy: { recordedAt: "desc" },
      take: 1000,
      select: { status: true, session: { select: { date: true, slot: true } } },
    });
    childrenData.push({
      id: childId,
      displayName,
      attendance: rows.map((r) => ({ date: day(r.session.date), slot: r.session.slot, status: r.status })),
      bus: await busHistory(tx, childId),
    });
  }

  let student: Record<string, unknown> | null = null;
  if (profile?.role === "student" && profile.studentId) {
    const rows = await tx.attendanceRow.findMany({
      where: { studentId: profile.studentId },
      orderBy: { recordedAt: "desc" },
      take: 1000,
      select: { status: true, session: { select: { date: true, slot: true } } },
    });
    student = {
      attendance: rows.map((r) => ({ date: day(r.session.date), slot: r.session.slot, status: r.status })),
      justificationStatus: await statusOnly(tx, profile.studentId),
      bus: await busHistory(tx, profile.studentId),
    };
  }

  return {
    format: "orya-data-export/1",
    generatedAt: new Date().toISOString(),
    notice:
      "Donnees personnelles du titulaire du compte, et pour un parent les presences et le statut du bus de ses enfants lies. Rien d'un autre responsable. Les pieces jointes ne sont pas incluses (metadonnees seulement).",
    account: user && { ...user, createdAt: d(user.createdAt), lastLoginAt: d(user.lastLoginAt) },
    profiles: profiles.map((p) => ({ ...p, createdAt: d(p.createdAt) })),
    guardianRecords: guardians.map((g) => ({
      fullName: g.fullName,
      email: g.email,
      phone: g.phone,
      phoneSecondary: g.phoneSecondary,
      address: g.address,
      children: g.students.map((s) => ({ id: s.student.id, displayName: s.student.displayName, relationship: s.relationship })),
    })),
    justifications: justifications.map((j) => ({
      id: j.id,
      fromDate: day(j.fromDate),
      toDate: day(j.toDate),
      reason: j.reason,
      status: j.status,
      createdAt: d(j.createdAt),
      attachment: j.file ? { name: j.file.originalName, mimeType: j.file.mimeType, sizeBytes: j.file.sizeBytes, included: false } : null,
    })),
    childrenData,
    parentalConsents: parentalConsents.map((c) => ({ ...c, grantedAt: d(c.grantedAt), revokedAt: d(c.revokedAt) })),
    consents: consents.map((c) => ({ ...c, grantedAt: d(c.grantedAt), revokedAt: d(c.revokedAt) })),
    deletionRequests: deletionRequests.map((r) => ({ ...r, requestedAt: d(r.requestedAt), effectiveAt: d(r.effectiveAt), cancelledAt: d(r.cancelledAt) })),
    rightsRequests: rightsRequests.map((r) => ({ ...r, createdAt: d(r.createdAt), handledAt: d(r.handledAt) })),
    auditTrail: auditTrail.map((a) => ({ ...a, createdAt: d(a.createdAt) })),
    student,
  };
}

function toLines(data: Awaited<ReturnType<typeof collect>>): string[] {
  const lines: string[] = [`Genere le ${data.generatedAt}`, data.notice, ""];
  const section = (title: string, value: unknown) => {
    lines.push(`== ${title} ==`);
    const items = Array.isArray(value) ? value : value ? [value] : [];
    if (items.length === 0) lines.push("(aucune donnee)");
    for (const item of items) lines.push(JSON.stringify(item));
    lines.push("");
  };
  section("Compte", data.account);
  section("Profils", data.profiles);
  section("Fiches responsable", data.guardianRecords);
  section("Justificatifs deposes", data.justifications);
  section("Enfants (presences, bus)", data.childrenData);
  section("Consentements parentaux", data.parentalConsents);
  section("Consentements", data.consents);
  section("Demandes de suppression", data.deletionRequests);
  section("Demandes de rectification / opposition", data.rightsRequests);
  section("Journal de vos actions", data.auditTrail);
  if (data.student) section("Espace eleve", data.student);
  return lines;
}