#!/usr/bin/env node
/**
 * T16 - controle statique (bloc 3b) : aucune route ne recoit un fichier sans passer
 * par le pipeline de scan (StorageService.intake : taille, antivirus AVANT type,
 * magic bytes, chiffrement ; ou StorageService.scanOnly pour un contenu analyse
 * mais jamais stocke).
 *
 * Regles :
 *  R1. Toute methode de controleur qui recoit un fichier (@UploadedFile(s), un
 *      intercepteur de fichiers, ou un @Body() dont le DTO porte un champ
 *      contentBase64) appelle une methode de service dont le corps (ou un
 *      assistant prive appele directement) contient storage.intake( ou storage.scanOnly(.
 *  R2. Hors de src/storage/, tout appel storage.store( / storage.put( est situe
 *      dans une methode qui appelle aussi storage.intake( (pas d'ecriture non analysee).
 *  R3. Auto-test : les pieges de test/static/t16-traps/*.trap.txt (hors build) DOIVENT
 *      etre detectes, et le temoin sain ne doit rien declencher ; sinon T16 echoue.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = join(here, "..", "..");
const PIPELINE = /\bstorage\.(intake|scanOnly)\(/;

function norm(p) { return p.split(sep).join("/"); }

/** Corps { ... } d'une methode dont la declaration commence a `start` (index du nom). */
function bodyAt(src, start) {
  let i = src.indexOf("(", start);
  if (i < 0) return null;
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") { depth -= 1; if (depth === 0) break; }
  }
  const open = src.indexOf("{", i);
  if (open < 0) return null;
  depth = 0;
  for (let j = open; j < src.length; j += 1) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") { depth -= 1; if (depth === 0) return { header: src.slice(start, open), body: src.slice(open, j + 1), end: j + 1 }; }
  }
  return null;
}

const DECL = /^ {2}(?:public |private |protected )?(?:async )?([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\s*\(/gm;
const SKIP = new Set(["if", "for", "while", "switch", "catch", "return", "constructor"]);

function methods(src) {
  const out = [];
  DECL.lastIndex = 0;
  let m;
  while ((m = DECL.exec(src))) {
    if (SKIP.has(m[1])) continue;
    const start = m.index + m[0].indexOf(m[1]);
    const b = bodyAt(src, start);
    if (!b) continue;
    // decorateurs : lignes "@..." immediatement au-dessus de la declaration
    const before = src.slice(0, m.index).split("\n");
    const deco = [];
    for (let k = before.length - 1; k >= 0; k -= 1) {
      const line = before[k].trim();
      if (line === "" && deco.length === 0) continue;
      if (line.startsWith("@") || line.startsWith(")") || line.startsWith("limits") || /^[A-Za-z_]+:/.test(line) || line.startsWith("}")) { deco.unshift(line); continue; }
      break;
    }
    out.push({ name: m[1], decorators: deco.join("\n"), header: b.header, body: b.body });
  }
  return out;
}

function isController(rel, content) {
  return /\.controller\.ts$/.test(rel) || /\/controllers\.ts$/.test(rel) || /@Controller\(/.test(content);
}

/** files: [{ rel, content }] */
export function check(files) {
  const v = [];
  // DTO portant un fichier en base64
  const fileDtos = new Set();
  for (const { content } of files) {
    const re = /export class (\w+)\s*\{([\s\S]*?)\n\}/g;
    let m;
    while ((m = re.exec(content))) if (/\bcontentBase64\b/.test(m[2])) fileDtos.add(m[1]);
  }
  // index des methodes de service
  const index = new Map();
  for (const f of files) {
    for (const meth of methods(f.content)) {
      if (!index.has(meth.name)) index.set(meth.name, []);
      index.get(meth.name).push({ ...meth, file: f });
    }
  }
  const reaches = (meth, file, depth = 0) => {
    if (PIPELINE.test(meth.body)) return true;
    if (depth >= 1) return false;
    const calls = [...meth.body.matchAll(/this\.(\w+)\(/g)].map((x) => x[1]);
    return calls.some((name) => methods(file.content).filter((x) => x.name === name).some((h) => reaches(h, file, depth + 1)));
  };
  for (const f of files) {
    if (!isController(f.rel, f.content)) continue;
    for (const meth of methods(f.content)) {
      const bodyDto = /@Body\(\)\s*\w+\s*:\s*(\w+)/.exec(meth.header);
      const receives =
        /@UploadedFiles?\(/.test(meth.header) ||
        /(FileInterceptor|FilesInterceptor|FileFieldsInterceptor|AnyFilesInterceptor|_INTERCEPTOR)\b/.test(meth.decorators) ||
        (bodyDto && fileDtos.has(bodyDto[1]));
      if (!receives) continue;
      const calls = [...meth.body.matchAll(/this\.\w+\.(\w+)\(/g)].map((x) => x[1]);
      const ok = calls.some((name) => (index.get(name) ?? []).some((target) => reaches(target, target.file)));
      if (!ok) v.push(`R1 ${f.rel} ${meth.name} : recoit un fichier sans pipeline de scan (storage.intake/scanOnly)`);
    }
  }
  for (const f of files) {
    if (f.rel.startsWith("src/storage/")) continue;
    for (const meth of methods(f.content)) {
      if (/\bstorage\.(store|put)\(/.test(meth.body) && !/\bstorage\.intake\(/.test(meth.body)) {
        v.push(`R2 ${f.rel} ${meth.name} : ecriture de fichier sans storage.intake dans la meme methode`);
      }
    }
  }
  return v;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

function load(p, relTo) { return { rel: norm(relative(relTo, p)), content: readFileSync(p, "utf8").replace(/\r\n/g, "\n") }; }

const real = walk(join(root, "src")).map((p) => load(p, root));
const violations = check(real);

// Auto-test : chaque piege est ajoute SEUL au code reel et doit produire une violation nouvelle.
const trapDir = join(here, "t16-traps");
const traps = readdirSync(trapDir).filter((n) => n.endsWith(".trap.txt")).sort();
const witnesses = readdirSync(trapDir).filter((n) => n.endsWith(".ok.txt")).sort();
let selfFail = 0;
const asSrc = (n) => ({ rel: `src/t16-trap/${n.replace(/\.(trap|ok)\.txt$/, "")}`, content: readFileSync(join(trapDir, n), "utf8").replace(/\r\n/g, "\n") });
for (const n of traps) {
  const extra = check([...real, asSrc(n)]).length - violations.length;
  if (extra < 1) { selfFail += 1; console.error(`T16 AUTO-TEST KO : piege non detecte ${n}`); }
}
for (const n of witnesses) {
  const extra = check([...real, asSrc(n)]).length - violations.length;
  if (extra !== 0) { selfFail += 1; console.error(`T16 AUTO-TEST KO : temoin sain signale ${n}`); }
}
if (traps.length < 4) { selfFail += 1; console.error("T16 AUTO-TEST KO : moins de 4 pieges"); }

if (violations.length || selfFail) {
  for (const x of violations) console.error(`T16 KO - ${x}`);
  process.exit(1);
}
const receiving = real.filter((f) => isController(f.rel, f.content)).length;
console.log(`T16 OK - ${real.length} fichiers (${receiving} controleurs), aucune route de fichier hors pipeline ; auto-test ${traps.length}/${traps.length} pieges detectes, ${witnesses.length} temoin(s) sain(s).`);