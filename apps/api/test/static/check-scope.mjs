#!/usr/bin/env node
/**
 * T17 - controle statique (t92) : perimetre CDC §17 et §1.
 *
 * Regles :
 *  S1. Pas de chat libre : aucune passerelle temps reel (@WebSocketGateway, @nestjs/websockets,
 *      socket.io, ws), aucun controleur dont le chemin evoque un chat ou une conversation, et
 *      cote parent (family/messages) aucune creation de message hors d'un message existant
 *      (chaque @Post porte ":id/..." : accuse de lecture ou reponse au fil de l'ecole).
 *  S2. Pas d'IA : aucune dependance ni import d'un SDK d'IA (openai, anthropic, langchain,
 *      generative-ai, huggingface, ollama, mistral, cohere, replicate, ai) ni appel a leurs API.
 *  S3. Massar jamais « synchronise » : aucune ligne de code produit (API src, console app/lib/
 *      components) qui mentionne Massar ne pretend synchroniser, envoyer, transmettre ou etre
 *      connectee a Massar (sauf negation explicite : pas / jamais / aucun) ; l'avertissement
 *      « pas connecte a Massar » reste affiche sur l'ecran Massar.
 *  S4. Auto-test : chaque piege test/static/t17-traps/*.trap.txt DOIT etre detecte et le temoin
 *      *.ok.txt ne doit rien declencher ; sinon T17 echoue.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const apiRoot = join(here, "..", "..");
const repoRoot = join(apiRoot, "..", "..");
const norm = (p) => p.split(sep).join("/");

const AI_PKG = /^(openai|@anthropic-ai\/.*|anthropic|langchain|@langchain\/.*|@google\/generative-ai|@google-ai\/.*|@huggingface\/.*|ollama|@mistralai\/.*|cohere-ai|replicate|ai|@ai-sdk\/.*)$/;
const AI_SRC = /from\s+["'](openai|@anthropic-ai\/[^"']*|langchain[^"']*|@langchain\/[^"']*|@google\/generative-ai|@huggingface\/[^"']*|ollama|@mistralai\/[^"']*|cohere-ai|replicate|ai|@ai-sdk\/[^"']*)["']|require\(\s*["'](openai|@anthropic-ai\/[^"']*|langchain)["']\)|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com/;
const RT_PKG = /^(@nestjs\/websockets|@nestjs\/platform-socket\.io|@nestjs\/platform-ws|socket\.io|socket\.io-client|ws)$/;
const RT_SRC = /@WebSocketGateway\b|from\s+["'](@nestjs\/websockets|socket\.io|socket\.io-client|ws)["']|new\s+WebSocket\(/;
const CHAT_ROUTE = /@Controller\(\s*["'`][^"'`]*(chat|conversation|discussion|messenger|groupe?s?\b)[^"'`]*["'`]/i;
const MASSAR_CLAIM = /synchro|(envoy|transmi|export\w*\s+automatiquement|import\w*\s+automatiquement)\w*\s+(vers|à|a|dans)\s+massar|api\s+massar|connect\w*\s+(à|a|avec)\s+massar|massar\s+(est\s+)?(mis\s+à\s+jour|synchronis)/i;
const NEGATION = /\b(pas|jamais|aucun|aucune|ni)\b|n['’]/i;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !/\.(spec|test)\./.test(name)) out.push(p);
  }
  return out;
}

/** Retourne la liste des violations pour un fichier source (chemin logique `label`). */
export function scanSource(label, src) {
  const v = [];
  if (RT_SRC.test(src)) v.push(`S1 ${label} : passerelle temps reel (chat) interdite`);
  if (CHAT_ROUTE.test(src)) v.push(`S1 ${label} : route de chat/conversation interdite`);
  const fam = src.match(/@Controller\(\s*["'`]family\/messages["'`]\s*\)([\s\S]*?)(?=@Controller\(|$)/);
  if (fam) {
    for (const m of fam[1].matchAll(/@Post\(\s*(["'`]([^"'`]*)["'`])?\s*\)/g)) {
      const path = m[2] ?? "";
      if (!/^:id\//.test(path)) v.push(`S1 ${label} : @Post("${path}") parent hors d'un message existant (message libre)`);
    }
  }
  if (AI_SRC.test(src)) v.push(`S2 ${label} : SDK ou API d'IA interdit`);
  src.split(/\r?\n/).forEach((line, i) => {
    if (/massar/i.test(line) && MASSAR_CLAIM.test(line) && !NEGATION.test(line)) {
      v.push(`S3 ${label}:${i + 1} : libelle Massar trompeur -> ${line.trim().slice(0, 120)}`);
    }
  });
  return v;
}

export function scanPackage(label, json) {
  const v = [];
  const pkg = JSON.parse(json);
  for (const dep of Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) })) {
    if (AI_PKG.test(dep)) v.push(`S2 ${label} : dependance d'IA ${dep}`);
    if (RT_PKG.test(dep)) v.push(`S1 ${label} : dependance temps reel ${dep}`);
  }
  return v;
}

let failures = [];
const sources = [
  ...walk(join(apiRoot, "src")),
  ...walk(join(repoRoot, "apps", "web", "app")),
  ...walk(join(repoRoot, "apps", "web", "lib")),
  ...walk(join(repoRoot, "apps", "web", "components")),
];
for (const f of sources) failures.push(...scanSource(norm(relative(repoRoot, f)), readFileSync(f, "utf8")));
for (const p of [join(repoRoot, "package.json"), join(apiRoot, "package.json"), join(repoRoot, "apps", "web", "package.json")]) {
  if (existsSync(p)) failures.push(...scanPackage(norm(relative(repoRoot, p)), readFileSync(p, "utf8")));
}
const massarPage = join(repoRoot, "apps", "web", "app", "(console)", "massar", "page.tsx");
if (!existsSync(massarPage) || !/pas connecté à Massar/.test(readFileSync(massarPage, "utf8"))) {
  failures.push("S3 apps/web/app/(console)/massar/page.tsx : avertissement « pas connecté à Massar » absent");
}

// S4 : auto-test sur les pieges.
const trapDir = join(here, "t17-traps");
const traps = existsSync(trapDir) ? readdirSync(trapDir) : [];
let trapCount = 0;
for (const name of traps) {
  const txt = readFileSync(join(trapDir, name), "utf8");
  const found = name.includes(".package.") ? scanPackage(name, txt) : scanSource(name, txt);
  if (name.endsWith(".trap.txt")) {
    trapCount += 1;
    if (found.length === 0) failures.push(`S4 piege non detecte : ${name}`);
  } else if (name.endsWith(".ok.txt") && found.length > 0) {
    failures.push(`S4 temoin sain signale a tort : ${name} -> ${found.join(" | ")}`);
  }
}
if (trapCount < 5) failures.push(`S4 pieges insuffisants (${trapCount} < 5)`);

if (failures.length) {
  for (const f of failures) console.error("  " + f);
  console.error(`T17 KO - ${failures.length} violation(s) (perimetre §17 / Massar §1)`);
  process.exit(1);
}
console.log(`T17 OK - ${sources.length} fichiers : pas de chat libre, pas d'IA, Massar jamais « synchronise » ; ${trapCount} pieges detectes`);
