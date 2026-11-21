import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { TenancyService } from "../core/tenancy.service";
import { StorageService } from "./storage.service";

/** Fichiers concernes : justificatifs (dont anterieurs au bloc 3, "legacy") jamais conclus "clean". */
const UNSCANNED_WHERE = {
  scanStatus: { in: ["pending", "error"] },
  purgedAt: null,
  purpose: { in: ["legacy", "justification"] },
} satisfies Prisma.StoredFileWhereInput;

export type RescanReport = { scanned: number; clean: number; infected: number; stillUnknown: number };
export type PendingPurgeReport = { due: number; purged: number; failed: number };

/**
 * Bloc 3b - reprise des justificatifs en "pending"/"error" (decision t49u, point 2).
 * - rescanPending : MEME pipeline antivirus, echec ferme (resultat inconnu => reste
 *   non telechargeable ; infecte => objet supprime, fiche marquee, audit critique).
 * - purgePendingBefore : purge EXPLICITE (CLI avec confirmation), auditee.
 * Contexte systeme : appele UNIQUEMENT par prisma/run-file-pending.ts (T15).
 */
@Injectable()
export class FileRescanService {
  private readonly logger = new Logger(FileRescanService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly storage: StorageService,
  ) {}

  async rescanPending(limit = 500): Promise<RescanReport> {
    const files = await this.tenancy.runSystem((tx) =>
      tx.storedFile.findMany({
        where: UNSCANNED_WHERE,
        select: { id: true, storageKey: true, schoolId: true, purpose: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      }),
    );
    const report: RescanReport = { scanned: 0, clean: 0, infected: 0, stillUnknown: 0 };
    for (const file of files) {
      report.scanned += 1;
      const scan = await this.storage.rescanStored(file.storageKey).catch(() => ({ status: "error" as const, engine: "clamav" }));
      if (scan.status === "clean") {
        await this.tenancy.runSystem(async (tx) => {
          await tx.storedFile.update({
            where: { id: file.id },
            data: { scanStatus: "clean", scannedAt: new Date(), scanEngine: scan.engine },
            select: { id: true },
          });
          await this.auditTx(tx, file, "file.rescan.clean", "info", {});
        });
        report.clean += 1;
      } else if (scan.status === "infected") {
        await this.storage.removeQuietly(file.storageKey);
        await this.tenancy.runSystem(async (tx) => {
          await tx.storedFile.update({
            where: { id: file.id },
            data: { scanStatus: "infected", scannedAt: new Date(), scanEngine: scan.engine, purgedAt: new Date() },
            select: { id: true },
          });
          await this.auditTx(tx, file, "file.rescan.infected", "critical", { signature: "signature" in scan ? scan.signature ?? null : null });
        });
        report.infected += 1;
      } else {
        report.stillUnknown += 1;
      }
    }
    return report;
  }

  async purgePendingBefore(before: Date, actor: string): Promise<PendingPurgeReport> {
    const due = await this.tenancy.runSystem((tx) =>
      tx.storedFile.findMany({
        where: { ...UNSCANNED_WHERE, createdAt: { lt: before } },
        select: { id: true, storageKey: true, schoolId: true, purpose: true },
        take: 1000,
      }),
    );
    let purged = 0;
    let failed = 0;
    for (const file of due) {
      try {
        await this.storage.remove(file.storageKey);
        await this.tenancy.runSystem(async (tx) => {
          await tx.storedFile.update({ where: { id: file.id }, data: { purgedAt: new Date() }, select: { id: true } });
          await this.auditTx(tx, file, "file.purged.unscanned", "warning", { before: before.toISOString(), actor });
        });
        purged += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Purge pending echec fichier=${file.id} : ${error instanceof Error ? error.message : "inconnu"}`);
      }
    }
    return { due: due.length, purged, failed };
  }

  private auditTx(
    tx: Prisma.TransactionClient,
    file: { id: string; schoolId: string; purpose: string },
    action: string,
    severity: "info" | "warning" | "critical",
    extra: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        actorId: null,
        schoolId: file.schoolId,
        action,
        entity: "StoredFile",
        entityId: file.id,
        severity,
        metadata: { purpose: file.purpose, ...extra } as Prisma.InputJsonValue,
      },
    });
  }
}