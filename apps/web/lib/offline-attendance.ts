"use client";

import { post } from "./api";
import type { AttendanceStatus, RosterStudent, SessionDetail } from "./types";

/**
 * ADR-003 (t89) : appel hors ligne dans la console.
 * - File de mutations dans IndexedDB (identifiant UUID v4 genere par l'appareil, heure de saisie
 *   de l'appareil) ; rien n'est retire de la file avant l'accuse du serveur.
 * - Copie locale minimale de la session et de la liste de classe (identifiant, nom, code eleve),
 *   purgee a la cloture et a la deconnexion.
 * - Reprise par lots de 200 au plus sur POST attendance/sessions/:id/sync (idempotent cote serveur).
 * - Service worker de portee /attendance : coquille et ressources statiques uniquement, jamais
 *   les reponses d'API (autre origine ou /api/).
 */
export const SHELL_CACHE = "orya-attendance-shell-v1";
const DB_NAME = "orya-offline";
const DB_VERSION = 1;
const SNAPSHOTS = "snapshots";
const QUEUE = "queue";
const BATCH = 200;

export type QueuedMutation = {
  clientMutationId: string;
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  recordedAt: string;
};

export type SessionSnapshot = {
  sessionId: string;
  detail: SessionDetail;
  students: RosterStudent[];
  savedAt: string;
};

export type SyncResultKind = "applied" | "duplicate" | "stale" | "closed" | "rejected";

type SyncResponse = {
  sessionStatus: "open" | "closed";
  version: number;
  results: {
    clientMutationId: string;
    studentId: string;
    result: SyncResultKind;
    status: AttendanceStatus | null;
    message?: string;
  }[];
};

export type SyncOutcome = {
  sent: number;
  applied: number;
  duplicate: number;
  stale: number;
  closed: number;
  rejected: { studentId: string; message: string }[];
  sessionStatus: "open" | "closed" | null;
};

export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** UUID v4 genere par l'appareil (crypto.randomUUID, ou getRandomValues a defaut). */
export function newMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB indisponible"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) {
        db.createObjectStore(SNAPSHOTS, { keyPath: "sessionId" });
      }
      if (!db.objectStoreNames.contains(QUEUE)) {
        db.createObjectStore(QUEUE, { keyPath: "clientMutationId" }).createIndex("sessionId", "sessionId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (objectStore: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = work(tx.objectStore(store));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/* --- Copie locale de la session --------------------------------------------- */

export async function saveSnapshot(snapshot: SessionSnapshot): Promise<void> {
  await withStore(SNAPSHOTS, "readwrite", (store) => {
    store.put(snapshot);
  });
}

export function readSnapshot(sessionId: string): Promise<SessionSnapshot | undefined> {
  return withStore<SessionSnapshot>(SNAPSHOTS, "readonly", (store) => store.get(sessionId) as IDBRequest<SessionSnapshot>);
}

export async function deleteSnapshot(sessionId: string): Promise<void> {
  await withStore(SNAPSHOTS, "readwrite", (store) => {
    store.delete(sessionId);
  });
}

/**
 * Deconnexion : purge des copies de listes de classe et de la coquille en cache.
 * La file de mutations est conservee (identifiants et statuts seulement, sans nom) pour ne
 * perdre aucune saisie ; elle n'est rejouee qu'avec une session valide, sous RLS et controle
 * d'affectation cote serveur.
 */
export async function purgeOfflineData(): Promise<void> {
  await withStore(SNAPSHOTS, "readwrite", (store) => {
    store.clear();
  }).catch(() => undefined);
  if (typeof caches !== "undefined") {
    await caches.delete(SHELL_CACHE).catch(() => false);
  }
}

/* --- File de mutations ------------------------------------------------------- */

export async function enqueue(mutations: QueuedMutation[]): Promise<void> {
  if (mutations.length === 0) return;
  await withStore(QUEUE, "readwrite", (store) => {
    for (const mutation of mutations) store.put(mutation);
  });
}

export async function pendingFor(sessionId: string): Promise<QueuedMutation[]> {
  const rows =
    (await withStore<QueuedMutation[]>(QUEUE, "readonly", (store) =>
      store.index("sessionId").getAll(IDBKeyRange.only(sessionId)) as IDBRequest<QueuedMutation[]>,
    )) ?? [];
  return rows.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

async function acknowledge(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withStore(QUEUE, "readwrite", (store) => {
    for (const id of ids) store.delete(id);
  });
}

/**
 * Rejoue la file d'une session. Une erreur reseau (TypeError) ou HTTP est propagee et la file
 * reste intacte ; chaque mutation acquittee par le serveur (quel que soit son resultat) est retiree.
 */
export async function syncSession(sessionId: string): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { sent: 0, applied: 0, duplicate: 0, stale: 0, closed: 0, rejected: [], sessionStatus: null };
  const pending = await pendingFor(sessionId);
  for (let index = 0; index < pending.length; index += BATCH) {
    const chunk = pending.slice(index, index + BATCH);
    const response = await post<SyncResponse>(`/attendance/sessions/${encodeURIComponent(sessionId)}/sync`, {
      mutations: chunk.map(({ clientMutationId, studentId, status, recordedAt }) => ({
        clientMutationId,
        studentId,
        status,
        recordedAt,
      })),
    });
    outcome.sent += chunk.length;
    outcome.sessionStatus = response.sessionStatus;
    for (const result of response.results) {
      if (result.result === "rejected") {
        outcome.rejected.push({
          studentId: result.studentId,
          message: result.message ?? "élève non inscrit dans la classe ou identifiant déjà utilisé",
        });
      } else {
        outcome[result.result] += 1;
      }
    }
    await acknowledge(response.results.map((result) => result.clientMutationId));
  }
  return outcome;
}

/* --- Service worker ---------------------------------------------------------- */

/** Met en cache la page courante et ses ressources statiques de meme origine (jamais l'API). */
async function precacheShell(): Promise<void> {
  if (typeof caches === "undefined") return;
  const origin = window.location.origin;
  const urls = new Set<string>([window.location.pathname, "/attendance"]);
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((node) => urls.add(node.src));
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]').forEach((node) => urls.add(node.href));
  for (const entry of performance.getEntriesByType("resource")) {
    urls.add(entry.name);
  }
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(
    [...urls]
      .map((value) => new URL(value, origin))
      .filter((url) => url.origin === origin && !url.pathname.startsWith("/api/") && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/attendance")))
      .map((url) => cache.add(url.href).catch(() => undefined)),
  );
}

export async function registerAttendanceWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw-attendance.js", { scope: "/attendance" });
    await navigator.serviceWorker.ready;
    await precacheShell();
  } catch {
    // Sans service worker, l'appel en ligne et la file IndexedDB restent disponibles.
  }
}
