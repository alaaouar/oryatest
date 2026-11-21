#!/usr/bin/env node
/**
 * T15 - controle statique : TenancyService.runSystem et runPublic (contextes sans
 * session, cross-tenant pour runSystem) ne sont atteignables QUE depuis les jobs
 * planifies (*.job.ts) et la CLI d'exploitation (prisma/run-*.ts), jamais depuis
 * un controleur HTTP.
 *
 * Regles :
 *  R1. Tout appel runSystem( / runPublic( dans src/ est situe dans une methode
 *      listee dans SYSTEM_ENTRYPOINTS (fichier -> methodes autorisees), ou dans
 *      core/tenancy.service.ts (definition).
 *  R2. Les methodes d'entree systeme publiques (PUBLIC_ENTRYPOINTS) ne sont
 *      appelees que depuis : leur propre fichier, un *.job.ts, ou prisma/run-*.ts.
 *  R3. Aucun controleur (*.controller.ts, controllers.ts, ou fichier contenant
 *      @Controller) ne mentionne runSystem, runPublic ni une methode d'entree systeme.
 *  R4. Auto-test : des sources piegees (controleur appelant runSystem, service HTTP
 *      appelant runPublic, controleur appelant une entree systeme) DOIVENT etre
 *      detectees ; sinon le controle lui-meme est en echec.
 * Aucune exception n'est ajoutee pour un chemin HTTP : il doit etre refactore.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

/** Methodes autorisees a ouvrir un contexte systeme (job / CLI uniquement). */
export const SYSTEM_ENTRYPOINTS = {
  "account/account-deletion.service.ts": ["runDueJob", "alertSuperAdmins", "anonymizeRequest", "replayDeletionRegister"],
  "storage/file-retention.service.ts": ["purgeExpired"],
  "storage/file-rescan.service.ts": ["rescanPending", "purgePendingBefore"],
  "privacy/data-export.service.ts": ["processDue", "purgeExpiredExports"],
  "school-billing/school-billing.service.ts": ["evaluateAllDue"],
  "attendance/attendance-reminder.service.ts": ["runReminders"],
  "results/weekly-summary.service.ts": ["runWeekly"],
};
/** Entrees publiques (appelables hors de leur fichier) : job et CLI seulement. */
export const PUBLIC_ENTRYPOINTS = ["runDueJob", "anonymizeRequest", "replayDeletionRegister", "purgeExpired", "rescanPending", "purgePendingBefore", "processDue", "purgeExpiredExports", "evaluateAllDue", "runReminders", "runWeekly"];

const METHOD_DECL = /^\s{2}(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/;
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function"]);

function norm(p) { return p.split(sep).join("/"); }

function enclosingMethod(lines, index) {
  for (let i = index; i >= 0; i -= 1) {
    const m = METHOD_DECL.exec(lines[i]);
    if (m && !KEYWORDS.has(m[1])) return m[1];
    if (/^(export\s+)?(abstract\s+)?class\s/.test(lines[i])) return null;
  }
  return null;
}

function isController(rel, content) {
  return /\.controller\.ts$/.test(rel) || /\/controllers\.ts$/.test(rel) || /@Controller\(/.test(content);
}

/** files: [{ rel: "src/...", content }] (src) et [{ rel: "prisma/..." }] (CLI). */
export function check(files) {
  const v = [];
  for (const { rel, content } of files) {
    const lines = content.split(/\r?\n/);
    const inSrc = rel.startsWith("src/");
    const srcRel = inSrc ? rel.slice(4) : rel;
    const isJob = /\.job\.ts$/.test(rel);
    const isCli = /^prisma\/run-[\w-]+\.ts$/.test(rel);
    const ctrl = inSrc && isController(rel, content);
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      const callsCtx = /\b(runSystem|runPublic)\s*(<[^>]*>)?\s*\(/.exec(line);
      if (callsCtx && inSrc && srcRel !== "core/tenancy.service.ts") {
        const method = enclosingMethod(lines, i);
        const allowed = SYSTEM_ENTRYPOINTS[srcRel] ?? [];
        if (!method || !allowed.includes(method)) {
          v.push(`R1 ${rel}:${i + 1} ${callsCtx[1]} appele dans ${method ?? "?"} (hors entree job/CLI)`);
        }
      }
      if (ctrl && /\b(runSystem|runPublic)\b/.test(line)) v.push(`R3 ${rel}:${i + 1} controleur HTTP mentionne runSystem/runPublic`);
      for (const ep of PUBLIC_ENTRYPOINTS) {
        if (!new RegExp(`\\.${ep}\\s*\\(`).test(line)) continue;
        const own = Object.entries(SYSTEM_ENTRYPOINTS).some(([f, ms]) => f === srcRel && ms.includes(ep));
        if (ctrl) v.push(`R3 ${rel}:${i + 1} controleur HTTP appelle ${ep}`);
        else if (!own && !isJob && !isCli) v.push(`R2 ${rel}:${i + 1} ${ep} appele hors job/CLI`);
      }
    });
  }
  return v;
}

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function selfTest() {
  const traps = [
    { rel: "src/x/trap.controller.ts", content: "@Controller()\nexport class T {\n  get() {\n    return this.tenancy.runSystem(async () => 1);\n  }\n}\n" },
    { rel: "src/x/trap.service.ts", content: "export class S {\n  async list() {\n    return this.tenancy.runPublic(async () => 1);\n  }\n}\n" },
    { rel: "src/x/trap2.controller.ts", content: "@Controller()\nexport class U {\n  go() {\n    return this.deletions.runDueJob();\n  }\n}\n" },
    { rel: "src/x/other.service.ts", content: "export class O {\n  async go() {\n    return this.files.purgeExpired(new Date());\n  }\n}\n" },
  ];
  const found = check(traps);
  const expect = ["R1 src/x/trap.controller.ts", "R3 src/x/trap.controller.ts", "R1 src/x/trap.service.ts", "R3 src/x/trap2.controller.ts", "R2 src/x/other.service.ts"];
  const missing = expect.filter((p) => !found.some((f) => f.startsWith(p)));
  return missing;
}

const missing = selfTest();
if (missing.length > 0) {
  console.error(`T15 FAIL - auto-test : pieges non detectes : ${missing.join(", ")}`);
  process.exit(1);
}

const files = [
  ...walk(join(root, "src")).filter((f) => f.endsWith(".ts")),
  ...walk(join(root, "prisma")).filter((f) => f.endsWith(".ts")),
].map((f) => ({ rel: norm(relative(root, f)), content: readFileSync(f, "utf8") }));
const violations = check(files);
const calls = files.filter((f) => f.rel.startsWith("src/") && f.rel !== "src/core/tenancy.service.ts")
  .reduce((n, f) => n + (f.content.match(/\b(runSystem|runPublic)\s*\(/g) ?? []).length, 0);
if (violations.length > 0) {
  console.error("T15 FAIL - contexte systeme atteignable hors job/CLI :");
  for (const x of violations) console.error(`  ${x}`);
  process.exit(1);
}
console.log(`T15 OK - ${files.length} fichiers, ${calls} appel(s) runSystem/runPublic, tous dans des entrees job/CLI ; auto-test 5/5 pieges detectes.`);