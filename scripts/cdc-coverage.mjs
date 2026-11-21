#!/usr/bin/env node
/**
 * ORYA - couverture CDC (t52u). Seule source autorisee pour publier un pourcentage.
 * Lit docs/matrice-cdc.md (arbre de travail, ou --ref=<commit> via git show).
 * Regles :
 *  - sections = identifiants de la matrice (1, 2, 3.1..3.5, M1..M10, 5..17) sauf 16 (Phasage) ;
 *  - lignes "externe" et "hors perimetre" exclues ; une section sans ligne en perimetre est exclue ;
 *  - section T si TOUTES ses lignes en perimetre sont "termine et teste", A si toutes "absent",
 *    sinon P ("partiel", "developpe non teste" ou melange) ;
 *  - couverture = (T + 0,5 x P) / sections, sections attendues : 29 (--expect=N).
 * Usage : node scripts/cdc-coverage.mjs [--ref=<commit>] [--expect=29] [--json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const ref = arg("ref");
const expect = Number(arg("expect") ?? 29);
const asJson = process.argv.includes("--json");

const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const text = ref ? git("show", `${ref}:docs/matrice-cdc.md`) : readFileSync(join(root, "docs/matrice-cdc.md"), "utf8");
const source = ref ? git("rev-parse", "--short", ref) : `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain", "--", "docs/matrice-cdc.md") ? "+arbre-modifie" : ""}`;
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const ID = /^(\d+(\.\d+)?|M\d+)$/;

function score(status) {
  const s = norm(status);
  if (/hors perimetre|externe/.test(s)) return "X";
  if (/^termine et teste/.test(s)) return "T";
  if (/^absent/.test(s)) return "A";
  if (/partiel|developpe non teste/.test(s)) return "P";
  throw new Error(`statut inconnu : "${status}"`);
}

const sections = new Map();
for (const line of text.split(/\r?\n/)) {
  if (!line.startsWith("|")) continue;
  const cells = line.split("|").slice(1, -1).map((c) => c.trim());
  if (cells.length < 3 || !ID.test(cells[0]) || cells[0] === "16") continue;
  const entry = sections.get(cells[0]) ?? { id: cells[0], T: 0, P: 0, A: 0, X: 0 };
  entry[score(cells[2])] += 1;
  sections.set(cells[0], entry);
}

const rows = [];
let excluded = 0;
for (const e of sections.values()) {
  const inScope = e.T + e.P + e.A;
  if (inScope === 0) { excluded += 1; rows.push({ ...e, status: "exclue" }); continue; }
  rows.push({ ...e, status: e.T === inScope ? "T" : e.A === inScope ? "A" : "P" });
}
const counted = rows.filter((r) => r.status !== "exclue");
const T = counted.filter((r) => r.status === "T").length;
const P = counted.filter((r) => r.status === "P").length;
const A = counted.filter((r) => r.status === "A").length;
const total = T + P + A;
const percent = total ? ((T + 0.5 * P) / total) * 100 : 0;

if (asJson) {
  process.stdout.write(JSON.stringify({ source, sections: total, T, P, A, excluded, percent: Number(percent.toFixed(1)), rows }) + "\n");
} else {
  console.log(`Couverture CDC - matrice ${source}`);
  console.log("| Section | Lignes T | Lignes P | Lignes A | Exclues | Statut section |");
  console.log("|---|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.id} | ${r.T} | ${r.P} | ${r.A} | ${r.X} | ${r.status} |`);
  console.log(`Sections : ${total} (attendu ${expect}) ; T=${T} P=${P} A=${A} ; exclues=${excluded}`);
  console.log(`Couverture (T + 0,5 x P) / ${total} = (${T} + ${0.5 * P}) / ${total} = ${percent.toFixed(1)} %`);
}
if (total !== expect) {
  console.error(`ECHEC : ${total} sections comptees, ${expect} attendues.`);
  process.exit(2);
}