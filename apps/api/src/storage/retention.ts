/**
 * Durees de conservation (bloc 3, CDC 9). Parametrables, en jours.
 * PROVISOIRES (decision t49u, point 3) : 365 j (justificatif) et 1825 j (scan de
 * consentement papier) sont a valider par le juriste avant le pilote ; ne pas les
 * presenter comme validees.
 */
export type RetentionPurpose = "justification" | "consent_scan" | "agenda";

/**
 * t50u : pieces jointes d'agenda (devoirs, evenements) : 365 j PROVISOIRE (environ une annee
 * scolaire), AGENDA_FILE_RETENTION_DAYS, en attente de l'avis du juriste ; purge par le meme job.
 */
export function retentionDays(purpose: RetentionPurpose): number {
  const raw =
    purpose === "justification"
      ? Number(process.env.JUSTIFICATION_FILE_RETENTION_DAYS ?? 365)
      : purpose === "agenda"
        ? Number(process.env.AGENDA_FILE_RETENTION_DAYS ?? 365)
        : Number(process.env.CONSENT_SCAN_RETENTION_DAYS ?? 1825);
  return Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 365);
}

export function retentionUntil(purpose: RetentionPurpose, from = new Date()): Date {
  return new Date(from.getTime() + retentionDays(purpose) * 86_400_000);
}