import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth.types";
import { toTenantContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { TenancyService } from "../core/tenancy.service";
import type { MulterFile } from "../parent-space/justifications.service";
import { retentionUntil } from "../storage/retention";
import { StorageService } from "../storage/storage.service";

/**
 * Bloc 3 : scan du formulaire de consentement papier (canal paper_school).
 * Meme pipeline que les justificatifs : 10 Mo, PDF/JPG/PNG/HEIC par magic bytes,
 * antivirus avant ecriture (infecte => 422), stockage prive chiffre, conservation
 * CONSENT_SCAN_RETENTION_DAYS, lecture par l'administration seulement.
 */
@Injectable()
export class ConsentScanService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async attach(auth: AuthContext, studentId: string, consentId: string, file: MulterFile | undefined, client: ClientInfo) {
    if (auth.role !== "direction" || !auth.schoolId) throw new ForbiddenException("Reserve a l'administration de l'ecole.");
    if (!file) throw new UnprocessableEntityException("Fichier \"file\" (multipart) requis.");
    const schoolId = auth.schoolId;
    const context = toTenantContext(auth);
    const consent = await this.tenancy.run(context, (tx) =>
      tx.parentalConsent.findFirst({
        where: { id: consentId, studentId, schoolId, channel: "paper_school" },
        select: { id: true, paperFileId: true, revokedAt: true },
      }),
    );
    if (!consent) throw new NotFoundException("Consentement papier introuvable.");
    if (consent.paperFileId) throw new ConflictException("Un scan est deja rattache a ce consentement.");

    const result = await this.storage.intake(file.originalname, file.buffer);
    if ("infected" in result) {
      await this.audit.scoped(context, {
        action: "file.rejected.infected",
        entity: "ParentalConsent",
        entityId: consentId,
        severity: "warning",
        metadata: { purpose: "consent_scan", signature: result.infected.signature ?? "inconnue", sha256: result.sha256 },
        ...client,
      });
      throw new UnprocessableEntityException("Fichier refuse : contenu malveillant detecte par l'antivirus.");
    }
    const upload = result.upload;
    const stored = await this.storage.store(schoolId, upload, result.scan);
    try {
      const row = await this.tenancy.run(context, async (tx) => {
        const f = await tx.storedFile.create({
          data: {
            schoolId,
            driver: this.storage.driverName,
            storageKey: stored.key,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            sha256: upload.sha256,
            originalName: upload.originalName,
            createdById: auth.userId,
            scanStatus: stored.scanStatus,
            scannedAt: stored.scannedAt,
            scanEngine: stored.scanEngine,
            encryption: stored.encryption,
            purpose: "consent_scan",
            retentionUntil: retentionUntil("consent_scan"),
          },
          select: { id: true, scanStatus: true, mimeType: true, sizeBytes: true },
        });
        const updated = await tx.parentalConsent.updateMany({
          where: { id: consentId, paperFileId: null },
          data: { paperFileId: f.id },
        });
        if (updated.count !== 1) throw new ConflictException("Un scan est deja rattache a ce consentement.");
        return f;
      });
      await this.audit.scoped(context, {
        action: "consent.paper.scan.attached",
        entity: "ParentalConsent",
        entityId: consentId,
        severity: "warning",
        metadata: { studentId, fileId: row.id, scanStatus: row.scanStatus },
        ...client,
      });
      return { consentId, file: { scanStatus: row.scanStatus, mimeType: row.mimeType, sizeBytes: row.sizeBytes } };
    } catch (error) {
      await this.storage.removeQuietly(stored.key);
      throw error;
    }
  }

  async download(auth: AuthContext, studentId: string, consentId: string) {
    if (auth.role !== "direction" || !auth.schoolId) throw new ForbiddenException("Reserve a l'administration de l'ecole.");
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, (tx) =>
      tx.parentalConsent.findFirst({
        where: { id: consentId, studentId, schoolId: auth.schoolId! },
        select: {
          paperFile: { select: { id: true, storageKey: true, mimeType: true, sizeBytes: true, originalName: true, scanStatus: true, purgedAt: true } },
        },
      }),
    );
    if (!row?.paperFile) throw new NotFoundException("Scan introuvable.");
    const target = await this.storage.downloadFor(row.paperFile);
    await this.audit.scoped(context, {
      action: "file.download.issued",
      entity: "StoredFile",
      entityId: row.paperFile.id,
      metadata: { purpose: "consent_scan", studentId, kind: target.kind },
    });
    return target;
  }
}