#!/usr/bin/env node
/**
 * A3 (P0-3) : controle statique des lectures de la table User.
 *
 * Regle : toute operation Prisma sur le modele user qui renvoie des lignes
 * (findUnique, findFirst, findMany, create, update, upsert, delete et variantes
 * OrThrow) doit porter un `select` explicite, sans `include`. Sinon Prisma lit
 * toutes les colonnes (SELECT * / RETURNING *), y compris passwordHash et mfaSecret,
 * que orya_app n'a plus le droit de lire.
 * Interdit aussi `user: true` (relation User chargee en entier depuis un autre modele).
 *
 * Usage : node test/static/check-user-select.mjs   (sortie 0 si conforme, 1 sinon)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const src = join(root, "src");
const OPS = /\.user\.(findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|create|update|upsert|delete)\s*\(/g;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Texte de l'argument entre la parenthese ouvrante et sa fermante (chaines ignorees). */
function argumentOf(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === "\\") { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(") depth += 1;
    if (c === ")") { depth -= 1; if (depth === 0) return text.slice(open + 1, i); }
  }
  return text.slice(open + 1);
}

const lineOf = (text, index) => text.slice(0, index).split(/\r?\n/).length;
const violations = [];
const files = walk(src).filter((file) => file.endsWith(".ts"));

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file);
  for (const match of text.matchAll(OPS)) {
    const arg = argumentOf(text, match.index + match[0].length - 1);
    if (!/\bselect\s*:/.test(arg)) {
      violations.push(`${rel}:${lineOf(text, match.index)} user.${match[1]} sans select explicite`);
    } else if (/\binclude\s*:/.test(arg)) {
      violations.push(`${rel}:${lineOf(text, match.index)} user.${match[1]} avec include (interdit)`);
    }
  }
  for (const match of text.matchAll(/\buser\s*:\s*true\b/g)) {
    violations.push(`${rel}:${lineOf(text, match.index)} relation user chargee en entier (user: true)`);
  }
}

if (violations.length > 0) {
  console.error("T14 FAIL - lecture de User sans select explicite :");
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}
console.log(`T14 OK - ${files.length} fichiers analyses, toute lecture de User a un select explicite.`);
