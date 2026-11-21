/**
 * t87u (tache 4) : regles pures de la cloture d'appel, extraites d'AttendanceService
 * (comportement inchange, testees en unitaire).
 * P0-5 (CDC M3) : a la cloture, une carte "A faire" (ParentAction) par eleve absent ou en
 * retard lie a au moins un parent active ; intitule "Justifier l'absence|le retard du
 * JJ/MM/AAAA (matin|apres-midi)" ; idempotence par (eleve, intitule).
 */
export type AttendanceMark = "present" | "absent" | "late" | string;

/** Date civile UTC au format JJ/MM/AAAA. */
export function frenchDay(date: Date): string {
  return date.toISOString().slice(0, 10).split("-").reverse().join("/");
}

export function slotLabel(slot: string): string {
  return slot === "morning" ? "matin" : "apr\u00e8s-midi";
}

/** Seuls les absents et les retards declenchent une notification et une carte. */
export function isAbsenceMark(status: AttendanceMark): status is "absent" | "late" {
  return status === "absent" || status === "late";
}

export function absenceActionTitle(status: "absent" | "late", date: Date, slot: string): string {
  return `${status === "absent" ? "Justifier l'absence" : "Justifier le retard"} du ${frenchDay(date)} (${slotLabel(slot)})`;
}

export type CloseRow = { studentId: string; status: AttendanceMark; date: Date; slot: string; linkedGuardians: number };

/**
 * Cartes a creer a la cloture : absent/retard, au moins un parent active, pas deja
 * presente (cle eleve + intitule), sans doublon dans le meme lot.
 */
export function absenceActionsToCreate(
  rows: readonly CloseRow[],
  existing: ReadonlySet<string>,
): { studentId: string; title: string }[] {
  const seen = new Set(existing);
  const out: { studentId: string; title: string }[] = [];
  for (const row of rows) {
    if (!isAbsenceMark(row.status) || row.linkedGuardians === 0) continue;
    const title = absenceActionTitle(row.status, row.date, row.slot);
    const key = actionKey(row.studentId, title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ studentId: row.studentId, title });
  }
  return out;
}

export function actionKey(studentId: string, title: string): string {
  return `${studentId}\u0000${title}`;
}

/**
 * F03 / B11 (t87u tache 5, ADR-003) : synchronisation hors ligne.
 * Heure client d'une mutation : jamais dans le futur (bornee a l'heure serveur) ; valeur
 * illisible -> heure serveur. Sert a l'arbitrage "dernier ecrit gagne" dans une session ouverte.
 */
export function effectiveClientTime(raw: string, now: Date): Date {
  const t = Date.parse(raw);
  if (!Number.isFinite(t) || t > now.getTime()) return new Date(now.getTime());
  return new Date(t);
}

export type SyncResult = "applied" | "duplicate" | "stale" | "closed" | "rejected";

/**
 * Arbitrage d'une mutation hors ligne pour une ligne d'appel :
 *  - session cloturee : "closed" (le serveur gagne, rien n'est ecrit) ;
 *  - identifiant client deja connu pour la meme ligne : "duplicate" (rejeu idempotent) ;
 *    deja connu pour une autre ligne : "rejected" ;
 *  - sinon dernier ecrit gagne : appliquee si son heure client est >= a celle de la ligne
 *    en base, "stale" sinon (une ancienne mutation rejouee n'ecrase pas une plus recente).
 */
export function syncDecision(input: {
  sessionClosed: boolean;
  known: { sameRow: boolean } | null;
  current: { recordedAt: Date } | null;
  clientAt: Date;
}): SyncResult {
  if (input.sessionClosed) return "closed";
  if (input.known) return input.known.sameRow ? "duplicate" : "rejected";
  if (input.current && input.clientAt.getTime() < input.current.recordedAt.getTime()) return "stale";
  return "applied";
}

/** t92 (CDC M3) : fenetre du rappel « appel non fait », en minutes locales (7h45 - 12h00). */
export const REMINDER_START_MINUTES = 7 * 60 + 45;
export const REMINDER_END_MINUTES = 12 * 60;

export function isReminderWindow(localMinutes: number): boolean {
  return localMinutes >= REMINDER_START_MINUTES && localMinutes < REMINDER_END_MINUTES;
}

/** Lien unique par classe et par jour : sert aussi de cle anti-doublon du rappel. */
export function reminderLink(classroomId: string, civilDate: string): string {
  return `/attendance?classe=${classroomId}&date=${civilDate}`;
}

/** Information eleve a la cloture (compte eleve actif seulement). */
export function studentNoticeTitle(status: "absent" | "late", date: Date, slot: string): string {
  return `${status === "absent" ? "Absence enregistr\u00e9e" : "Retard enregistr\u00e9"} le ${frenchDay(date)} (${slotLabel(slot)})`;
}
