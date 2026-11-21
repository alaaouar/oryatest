#!/usr/bin/env node
/**
 * T13 — controle statique d'isolation (Lot 1).
 *
 * Regle : aucune table metier ne doit etre lue ou ecrite via le client Prisma
 * injecte (this.prisma.<modele>). Tout doit passer par TenancyService (run,
 * runIdentity, runSchool, runOnboarding, runSchoolCode, runSystem, runPublic), qui pose le contexte RLS.
 *
 * Les modeles d'identite (user, userProfile, device) sont hors perimetre :
 * la connexion doit fonctionner avant qu'une ecole ne soit connue (ADR-002).
 *
 * Usage : node test/static/check-tenancy.mjs
 * Sortie : 0 si conforme, 1 sinon.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const src = join(root, "src");

const BUSINESS_MODELS = [
  "student",
  "guardian",
  "studentGuardian",
  "school",
  "subscription",
  "invitation",
  "auditLog",
  "consent",
  "consentText",
  "parentalConsent",
  "accountDeletionRequest",
  "deletionRegister",
  "storedFile",
  "absenceJustification",
  "notification",
  "parentAction",
  "message",
  "messageRecipient",
  "messageReply",
  "agendaItem",
  "agendaAttachment",
  "massarExport",
  "plan",
  "invoice",
  "usageSnapshot",
  "passwordResetToken",
];

/** Fichiers autorises a executer du SQL brut (ils posent le contexte). */
const RAW_SQL_ALLOWED = [join("core", "tenancy.service.ts"), join("health", "health.controller.ts"), join("auth", "auth-lookup.sql.ts")];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(src).filter((file) => file.endsWith(".ts"));
const violations = [];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const rel = relative(root, file);
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) {
      return;
    }

    for (const model of BUSINESS_MODELS) {
      if (line.includes(`this.prisma.${model}`)) {
        violations.push(`${rel}:${index + 1} acces direct a ${model} hors TenancyService`);
      }
    }

    if (line.includes("$queryRawUnsafe") || line.includes("$executeRawUnsafe")) {
      violations.push(`${rel}:${index + 1} SQL brut non securise`);
    }

    const usesRawSql = line.includes("$queryRaw") || line.includes("$executeRaw");
    if (usesRawSql && !RAW_SQL_ALLOWED.some((allowed) => rel.includes(allowed))) {
      violations.push(`${rel}:${index + 1} SQL brut hors core/tenancy.service.ts`);
    }
  });
}

if (violations.length > 0) {
  console.error("T13 FAIL — acces metier hors TenancyService :");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log(`T13 OK — ${files.length} fichiers analyses, aucun acces metier hors TenancyService.`);