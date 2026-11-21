#!/usr/bin/env node
/**
 * Contrôle d'encodage et de corruption (Lot 1).
 *
 * Règles :
 *  - aucun BOM dans les fichiers texte (.ts, .tsx, .md, .sql, .json, .mjs, .yml, .css) ;
 *  - aucun caractère de double encodage (U+00C3 / U+00C2) : signature d'un fichier
 *    UTF-8 relu en Windows-1252 puis réenregistré ;
 *  - un script PowerShell sans BOM doit être en ASCII pur, sinon Windows
 *    PowerShell 5.1 le lit en ANSI et les accents cassent l'analyse.
 *
 * Le contrôle s'exclut lui-même : il cite les séquences recherchées.
 *
 * Usage : node test/static/check-encoding.mjs
 * Sortie : 0 si conforme, 1 sinon.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");
const selfPath = fileURLToPath(import.meta.url);
const targets = [join(repoRoot, "apps"), join(repoRoot, "docs")];

const TEXT_EXTENSIONS = [".ts", ".tsx", ".md", ".sql", ".json", ".mjs", ".yml", ".yaml", ".css"];
const SKIP_PATTERN = /(^|\/)(node_modules|\.next|dist|coverage|\.git)(\/|$)|package-lock\.json|next-env\.d\.ts|tsbuildinfo/;

/** Séquences typiques d'un texte UTF-8 décodé en Windows-1252. */
const MOJIBAKE = new RegExp("[\\u00c3\\u00c2]");

function walk(directory) {
  const entries = readdirSync(directory);

  return entries.flatMap((entry) => {
    const full = join(directory, entry);
    const rel = relative(repoRoot, full).split(/[\\/]/).join("/");

    if (SKIP_PATTERN.test(rel)) {
      return [];
    }

    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const violations = [];
let checked = 0;

for (const target of targets) {
  let files;

  try {
    files = walk(target);
  } catch {
    continue;
  }

  for (const file of files) {
    if (file === selfPath) {
      continue;
    }

    const rel = relative(repoRoot, file).split(/[\\/]/).join("/");
    const extension = file.slice(file.lastIndexOf("."));
    const bytes = readFileSync(file);
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const text = bytes.toString("utf8");

    checked += 1;

    if (extension === ".ps1") {
      const nonAscii = [...bytes].filter((byte) => byte > 127).length;
      if (!hasBom && nonAscii > 0) {
        violations.push(
          `${rel} : script PowerShell sans BOM contenant ${nonAscii} octets non ASCII (Windows PowerShell 5.1 le lira en ANSI)`,
        );
      }
      continue;
    }

    if (!TEXT_EXTENSIONS.includes(extension)) {
      continue;
    }

    if (hasBom) {
      violations.push(`${rel} : BOM UTF-8 interdit dans un fichier source`);
    }

    if (MOJIBAKE.test(text)) {
      violations.push(`${rel} : caractères de double encodage détectés (U+00C3 / U+00C2)`);
    }
  }
}

if (violations.length > 0) {
  console.error("Encodage FAIL :");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log(`Encodage OK — ${checked} fichiers contrôlés (BOM, double encodage, PowerShell ASCII).`);
