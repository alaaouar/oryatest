import { Injectable, Logger } from "@nestjs/common";
import { TenancyService } from "../core/tenancy.service";
import { StorageService } from "./storage.service";

/**
 * Purge de conservation (bloc 3) : supprime l'objet stocke des fichiers dont
 * retentionUntil est depasse, marque purgedAt et audite. Contexte systeme :
 * appele UNIQUEMENT par FileRetentionJob et prisma/run-file-purge.ts (T15).
 * La fiche (justificatif, consentement) reste ; seul le fichier disparait.
 */
@Injectable()
export class FileRetentionService {
  private readonly logger = new Logger(FileRetentionService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly storage: StorageService,
  ) {}

  async purgeExpired(now: Date = new Date()): Promise<{ due: number; purged: number; failed: number }> {
    const due = await this.tenancy.runSystem(async (tx) =>
      tx.storedFile.findMany({
        where: { retentionUntil: { lte: now }, purgedAt: null },
        select: { id: true, storageKey: true, schoolId: true, purpose: true, retentionUntil: true },
        orderBy: { retentionUntil: "asc" },
        take: 500,
      }),
    );
    let purged = 0;
    let failed = 0;
    for (const file of due) {
      try {
        await this.storage.remove(file.storageKey);
        await this.tenancy.runSystem(async (tx) => {
          await tx.storedFile.update({ where: { id: file.id }, data: { purgedAt: now }, select: { id: true } });
          await tx.auditLog.create({
            data: {
              actorId: null,
              schoolId: file.schoolId,
              action: "file.purged",
              entity: "StoredFile",
              entityId: file.id,
              severity: "info",
              metadata: { purpose: file.purpose, retentionUntil: file.retentionUntil?.toISOString() ?? null },
            },
          });
        });
        purged += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Purge echec fichier=${file.id} : ${error instanceof Error ? error.message : "inconnu"}`);
      }
    }
    return { due: due.length, purged, failed };
  }
}