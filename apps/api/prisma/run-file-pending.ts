/**
 * Bloc 3b - reprise des justificatifs jamais analyses "clean" (ops / tests), sans AppModule.
 *   --rescan                                  : re-analyse ClamAV (meme pipeline, echec ferme)
 *   --purge --before=ISO --confirm=<base>     : purge EXPLICITE, auditee ; <base> doit etre
 *                                               le nom de la base de DATABASE_URL.
 * Garde-fous : la purge refuse les bases de developpement "orya" et "orya_v2" et exige
 * ORYA_PENDING_PURGE_ALLOW=1. Aucun secret n'est affiche.
 */
import { PrismaClient } from "@prisma/client";
import { TenancyService } from "../src/core/tenancy.service";
import { AntivirusService } from "../src/storage/antivirus";
import { FileRescanService } from "../src/storage/file-rescan.service";
import { createDriver } from "../src/storage/storage.module";
import { StorageService } from "../src/storage/storage.service";

const FORBIDDEN_DATABASES = new Set(["orya", "orya_v2"]);

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "";
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL absente");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  const rescan = arg("rescan") !== undefined;
  const purge = arg("purge") !== undefined;
  if (rescan === purge) throw new Error("Choisir exactement une action : --rescan ou --purge");
  let before: Date | null = null;
  if (purge) {
    if (FORBIDDEN_DATABASES.has(dbName)) throw new Error(`REFUS : purge interdite sur la base '${dbName}'.`);
    if (process.env.ORYA_PENDING_PURGE_ALLOW !== "1") throw new Error("REFUS : ORYA_PENDING_PURGE_ALLOW=1 requis.");
    if (arg("confirm") !== dbName) throw new Error("REFUS : --confirm=<nom de la base> requis.");
    before = new Date(arg("before") ?? "");
    if (Number.isNaN(before.getTime())) throw new Error("--before=ISO8601 requis");
  }
  const prisma = new PrismaClient({ datasourceUrl: url, log: ["warn", "error"] }) as unknown as import("../src/core/prisma.service").PrismaService;
  await (prisma as PrismaClient).$connect();
  try {
    const service = new FileRescanService(new TenancyService(prisma), new StorageService(createDriver(), new AntivirusService()));
    const result = purge
      ? { action: "purge", ...(await service.purgePendingBefore(before!, process.env.USERNAME ?? process.env.USER ?? "cli")) }
      : { action: "rescan", ...(await service.rescanPending()) };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await (prisma as PrismaClient).$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});