import type { ConsentPurpose } from "@prisma/client";

/**
 * t87u (tache 4) : calcul pur du statut de consentement d'un eleve pour une finalite,
 * extrait de ConsentOverviewService (comportement inchange, teste en unitaire).
 * Aucun refus explicite dans le modele : sans consentement -> "pending" ; au moins un
 * consentement actif (non retire) -> "accepted" ; uniquement des retraits -> "withdrawn".
 */
export type ConsentStudentStatus = "accepted" | "withdrawn" | "pending";

export type ConsentRecordLike = { id: string; purpose: ConsentPurpose; revokedAt: Date | null; textId: string };

/** `records` est trie du plus recent au plus ancien (grantedAt desc), comme la requete. */
export function purposeStatus(
  records: readonly ConsentRecordLike[],
  purpose: ConsentPurpose,
): { status: ConsentStudentStatus; latestId: string | null } {
  const mine = records.filter((r) => r.purpose === purpose);
  const active = mine.find((r) => !r.revokedAt) ?? null;
  const status: ConsentStudentStatus = active ? "accepted" : mine.length > 0 ? "withdrawn" : "pending";
  const latest = active ?? mine[0] ?? null;
  return { status, latestId: latest?.id ?? null };
}

/** Compteurs par version de texte : acceptations en cours et retraits. */
export function addTextCounts(
  counts: Map<string, { accepted: number; withdrawn: number }>,
  records: readonly ConsentRecordLike[],
): Map<string, { accepted: number; withdrawn: number }> {
  for (const r of records) {
    const entry = counts.get(r.textId) ?? { accepted: 0, withdrawn: 0 };
    if (r.revokedAt) entry.withdrawn += 1;
    else entry.accepted += 1;
    counts.set(r.textId, entry);
  }
  return counts;
}