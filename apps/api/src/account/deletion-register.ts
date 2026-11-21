import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { isAbsolute } from "node:path";
import { wormAppend, wormConfigured, wormReadAll, wormRequired, type WormRead } from "./deletion-journal-worm";

/**
 * Registre des suppressions : empreintes et copie append-only hors base.
 *
 * - Empreintes : HMAC-SHA256 avec une cle secrete HORS base
 *   (DELETION_REGISTER_HMAC_KEY, >= 32 octets en base64). Un SHA-256 simple d'un
 *   e-mail se retrouve par dictionnaire ; le HMAC exige la cle.
 * - Lignes historiques (bloc 2, SHA-256 simple) : toujours reconnues au rejeu
 *   (legacySha256), jamais recalculees (l'e-mail d'origine n'existe plus).
 * - Journal : DELETION_REGISTER_JOURNAL (chemin absolu), une ligne JSON par
 *   suppression, ouverte en mode ajout ("a") puis fsync. Chaque ligne est chainee
 *   (champ prev + mac) : toute modification ou suppression d'une ligne casse la
 *   chaine et le rejeu refuse le journal. En production : fichier sur un volume
 *   distinct de la base, attribut append-only (chattr +a) ou stockage WORM.
 * - t62u B3 : copie WORM (S3 Object Lock COMPLIANCE, identifiants d'ecriture seule distincts)
 *   de chaque ligne, ecrite AVANT la copie locale ; exigee en production
 *   (deletion-journal-worm.ts). Le rejeu lit la copie WORM (identifiants de lecture) en plus
 *   du fichier local : la perte ou l'alteration du fichier local n'empeche plus le rejeu.
 * Echec ferme : sans cle ou sans journal, l'anonymisation echoue (rollback).
 */

export type RegisterEntry = {
  emailHash: string;
  userIdHash: string;
  studentIdHash: string | null;
  schoolIdHash: string | null;
  kind: "self" | "student_by_guardian" | "student_by_school";
  anonymizedAt: string;
  sourceRequestId: string | null;
};

type JournalLine = RegisterEntry & { v: 1; alg: "hmac-sha256"; prev: string; mac: string };

const GENESIS = "0".repeat(64);

function registerKey(): Buffer {
  const raw = (process.env.DELETION_REGISTER_HMAC_KEY ?? "").trim();
  const key = Buffer.from(raw, "base64");
  if (!raw || key.length < 32) {
    throw new Error("DELETION_REGISTER_HMAC_KEY absente ou trop courte (32 octets base64 minimum) : anonymisation refusee.");
  }
  return key;
}

/** Empreinte du registre : HMAC-SHA256(cle hors base, valeur). */
export function registerHmac(value: string): string {
  return createHmac("sha256", registerKey()).update(value, "utf8").digest("hex");
}

/** Empreinte historique (bloc 2) : SHA-256 simple. Lecture seule, pour le rejeu. */
export function legacySha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function journalPath(): string {
  const p = (process.env.DELETION_REGISTER_JOURNAL ?? "").trim();
  if (!p || !isAbsolute(p)) {
    throw new Error("DELETION_REGISTER_JOURNAL absent ou relatif : copie hors base impossible, anonymisation refusee.");
  }
  return p;
}

function canonical(e: RegisterEntry, prev: string): string {
  return JSON.stringify([1, prev, e.emailHash, e.userIdHash, e.studentIdHash, e.schoolIdHash, e.kind, e.anonymizedAt, e.sourceRequestId]);
}

function lineMac(e: RegisterEntry, prev: string): string {
  return createHmac("sha256", registerKey()).update(canonical(e, prev), "utf8").digest("hex");
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Lit et verifie le journal. Leve une erreur si la chaine est rompue. */
export function readJournal(path = journalPath()): RegisterEntry[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const out: RegisterEntry[] = [];
  let prev = GENESIS;
  lines.forEach((raw, index) => {
    let parsed: JournalLine;
    try {
      parsed = JSON.parse(raw) as JournalLine;
    } catch {
      throw new Error(`Journal du registre illisible (ligne ${index + 1}).`);
    }
    const entry = toEntry(parsed);
    if (parsed.prev !== prev || !safeEq(parsed.mac ?? "", lineMac(entry, prev))) {
      throw new Error(`Journal du registre altere (chaine rompue ligne ${index + 1}) : rejeu refuse.`);
    }
    prev = parsed.mac;
    out.push(entry);
  });
  return out;
}

function lastMac(path: string): string {
  if (!existsSync(path)) return GENESIS;
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return GENESIS;
  return (JSON.parse(lines[lines.length - 1]!) as JournalLine).mac;
}

/**
 * Ajoute une entree au journal hors base. Appele DANS la transaction d'anonymisation, avant
 * le commit : si une ecriture echoue, la suppression est annulee. Ordre : copie WORM d'abord
 * (si configuree ; exigee en production), puis fichier local (mode "a" + fsync). Une entree
 * ecrite sans commit est sans effet nuisible : elle correspond a une demande de suppression
 * echue, et le rejeu est idempotent.
 */
export async function appendJournal(entry: RegisterEntry, path = journalPath()): Promise<void> {
  const prev = lastMac(path);
  const line: JournalLine = { v: 1, alg: "hmac-sha256", ...entry, prev, mac: lineMac(entry, prev) };
  const json = JSON.stringify(line);
  if (wormConfigured()) {
    await wormAppend(json, entry.anonymizedAt, line.mac);
  } else if (wormRequired()) {
    throw new Error("Journal WORM non configure (DELETION_JOURNAL_WORM_BUCKET) : anonymisation refusee en production.");
  }
  const fd = openSync(path, "a", 0o600);
  try {
    writeSync(fd, `${json}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Verifie un ensemble de lignes (copie WORM) : chaque MAC doit etre valide pour sa ligne et son
 * predecesseur, et chaque predecesseur doit etre la racine ou une ligne presente. Plusieurs
 * racines (fichier local perdu puis recree) et bifurcations (ecriture WORM suivie d'un echec
 * local) sont admises ; doublons fusionnes. Toute ligne alteree ou orpheline : rejeu refuse.
 */
export function verifyJournalLines(lines: string[]): { entries: RegisterEntry[]; roots: number } {
  const byMac = new Map<string, JournalLine>();
  lines.forEach((raw, index) => {
    let parsed: JournalLine;
    try {
      parsed = JSON.parse(raw) as JournalLine;
    } catch {
      throw new Error(`Journal WORM illisible (objet ${index + 1}).`);
    }
    const entry = toEntry(parsed);
    if (typeof parsed.prev !== "string" || !safeEq(parsed.mac ?? "", lineMac(entry, parsed.prev))) {
      throw new Error(`Journal WORM altere (objet ${index + 1}) : rejeu refuse.`);
    }
    byMac.set(parsed.mac, parsed);
  });
  let roots = 0;
  for (const l of byMac.values()) {
    if (l.prev === GENESIS) roots += 1;
    else if (!byMac.has(l.prev)) throw new Error("Journal WORM incomplet (predecesseur absent) : rejeu refuse.");
  }
  const entries = [...byMac.values()].map(toEntry).sort((a, b) => a.anonymizedAt.localeCompare(b.anonymizedAt));
  return { entries, roots };
}

function toEntry(parsed: JournalLine): RegisterEntry {
  return {
    emailHash: parsed.emailHash,
    userIdHash: parsed.userIdHash,
    studentIdHash: parsed.studentIdHash ?? null,
    schoolIdHash: parsed.schoolIdHash ?? null,
    kind: parsed.kind,
    anonymizedAt: parsed.anonymizedAt,
    sourceRequestId: parsed.sourceRequestId ?? null,
  };
}

export type JournalSources = {
  entries: RegisterEntry[];
  local: "ok" | "absent" | "altere" | "non configure";
  localEntries: number;
  worm: (Omit<WormRead, "lines"> & { entries: number; roots: number }) | null;
};

/**
 * Sources du rejeu : fichier local (si present et intact) + copie WORM (si les identifiants de
 * LECTURE sont fournis). Sans copie WORM, un fichier local altere fait echouer le rejeu (bloc 2).
 * Avec copie WORM, il est signale (local = "altere") et la copie WORM fait foi.
 */
export async function readJournalSources(env: NodeJS.ProcessEnv = process.env): Promise<JournalSources> {
  const wormReader = wormConfigured(env) && (env.DELETION_JOURNAL_WORM_READER_ACCESS_KEY_ID ?? "").trim().length > 0;
  let localEntries: RegisterEntry[] = [];
  let local: JournalSources["local"] = "non configure";
  const rawPath = (env.DELETION_REGISTER_JOURNAL ?? "").trim();
  if (rawPath || !wormReader) {
    const path = journalPath();
    if (!existsSync(path)) local = "absent";
    else {
      try {
        localEntries = readJournal(path);
        local = "ok";
      } catch (error) {
        if (!wormReader) throw error;
        local = "altere";
      }
    }
  }
  if (!wormReader) return { entries: localEntries, local, localEntries: localEntries.length, worm: null };
  const read = await wormReadAll(env);
  const verified = verifyJournalLines(read.lines);
  const seen = new Set(verified.entries.map((e) => e.emailHash));
  const merged = [...verified.entries, ...localEntries.filter((e) => !seen.has(e.emailHash))];
  const { lines: _lines, ...stats } = read;
  void _lines;
  return { entries: merged, local, localEntries: localEntries.length, worm: { ...stats, entries: verified.entries.length, roots: verified.roots } };
}
