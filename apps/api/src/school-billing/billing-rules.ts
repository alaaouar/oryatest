/**
 * Bloc 5 (Avenant n 1) : regles de facturation ecole, pures et testables.
 * Montants en centimes de dirham (minor). Aucune dependance a la base.
 */

export type BillingStatus = "trial" | "invoiced" | "paid" | "overdue" | "suspended";
export type DocKind = "invoice" | "complementary" | "credit_note";

export const SERIES: Record<DocKind, "FA" | "AV"> = { invoice: "FA", complementary: "FA", credit_note: "AV" };
const DAY = 86_400_000;

export function invoiceNumber(series: string, year: number, seq: number): string {
  return `ORYA-${series}-${year}-${String(seq).padStart(6, "0")}`;
}

/** TVA arrondie au centime (arrondi commercial, identique au CHECK SQL pour des montants positifs). */
export function vatOf(htMinor: number, vatRateBp: number): number {
  return Math.round((htMinor * vatRateBp) / 10_000);
}

export function ttcOf(htMinor: number, vatRateBp: number): number {
  return htMinor + vatOf(htMinor, vatRateBp);
}

export function totals(quantity: number, unitPriceHtMinor: number, vatRateBp: number) {
  const totalHtMinor = quantity * unitPriceHtMinor;
  const totalVatMinor = vatOf(totalHtMinor, vatRateBp);
  return { totalHtMinor, totalVatMinor, totalTtcMinor: totalHtMinor + totalVatMinor };
}

export function civilDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addDays(day: Date, days: number): Date {
  return new Date(civilDay(day).getTime() + days * DAY);
}

export function isoDay(value: Date): string {
  return civilDay(value).toISOString().slice(0, 10);
}

/** "2026-2027" + "10-31" -> 2026-10-31 ; "2026-2027" + "03-15" -> 2027-03-15 (annee scolaire sept. -> aout). */
export function referenceDateFor(schoolYear: string, monthDay: string): Date {
  const m = /^(\d{4})-(\d{4})$/.exec(schoolYear);
  const md = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (!m || !md || Number(m[2]) !== Number(m[1]) + 1) throw new Error("annee scolaire ou date de reference invalide");
  const month = Number(md[1]);
  const year = month >= 9 ? Number(m[1]) : Number(m[2]);
  const date = new Date(Date.UTC(year, month - 1, Number(md[2])));
  if (date.getUTCMonth() !== month - 1) throw new Error("date de reference invalide");
  return date;
}

export function schoolYearBounds(schoolYear: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{4})$/.exec(schoolYear);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) throw new Error("annee scolaire invalide");
  return { start: new Date(Date.UTC(Number(m[1]), 8, 1)), end: new Date(Date.UTC(Number(m[2]), 7, 31)) };
}

/**
 * Regle de comptage (docs/facturation-ecoles.md) : un eleve est facture s'il a une inscription
 * pour l'annee scolaire ET qu'il est actif a la date de reference :
 *   (startsOn absent OU startsOn <= reference) ET (endsOn absent OU endsOn > reference).
 * Inscrit apres la reference : non compte (facture complementaire). Sorti avant ou le jour
 * de la reference : non compte. Sorti apres la reference : compte (annee due).
 */
export function isActiveAt(enrollment: { startsOn: Date | null; endsOn: Date | null }, reference: Date): boolean {
  const ref = civilDay(reference).getTime();
  const starts = enrollment.startsOn ? civilDay(enrollment.startsOn).getTime() : null;
  const ends = enrollment.endsOn ? civilDay(enrollment.endsOn).getTime() : null;
  return (starts === null || starts <= ref) && (ends === null || ends > ref);
}

export type LedgerDoc = { id: string; kind: DocKind; quantity: number; totalTtcMinor: number; dueDate: Date; relatedInvoiceId: string | null };
export type LedgerPayment = { invoiceId: string; amountMinor: number };

/** Solde global et reste du par document (avoirs imputes sur la facture annuelle liee). */
export function ledger(docs: LedgerDoc[], payments: LedgerPayment[]) {
  const billed = docs.filter((d) => d.kind !== "credit_note").reduce((a, d) => a + d.totalTtcMinor, 0);
  const credited = docs.filter((d) => d.kind === "credit_note").reduce((a, d) => a + d.totalTtcMinor, 0);
  const paid = payments.reduce((a, p) => a + p.amountMinor, 0);
  const outstanding = new Map<string, number>();
  for (const d of docs) {
    if (d.kind === "credit_note") continue;
    const credits = docs.filter((c) => c.kind === "credit_note" && c.relatedInvoiceId === d.id).reduce((a, c) => a + c.totalTtcMinor, 0);
    const pays = payments.filter((p) => p.invoiceId === d.id).reduce((a, p) => a + p.amountMinor, 0);
    outstanding.set(d.id, Math.max(0, d.totalTtcMinor - credits - pays));
  }
  const billedQuantity = docs.reduce((a, d) => a + (d.kind === "credit_note" ? -d.quantity : d.quantity), 0);
  return { billedMinor: billed, creditedMinor: credited, paidMinor: paid, balanceMinor: billed - credited - paid, outstanding, billedQuantity };
}

/**
 * Statut derive (jamais saisi a la main) :
 *   aucun document emis -> essai ; solde <= 0 -> paye ;
 *   sinon, echeance la plus ancienne restant due : avant ou le jour J -> facture ;
 *   J+1 .. J+preavis -> en retard ; au-dela -> suspendu (lecture seule, aucune donnee supprimee ni masquee).
 */
export function deriveStatus(docs: LedgerDoc[], payments: LedgerPayment[], noticeDays: number, now: Date): BillingStatus {
  if (!docs.some((d) => d.kind !== "credit_note")) return "trial";
  const l = ledger(docs, payments);
  if (l.balanceMinor <= 0) return "paid";
  const dueDates = docs.filter((d) => (l.outstanding.get(d.id) ?? 0) > 0).map((d) => civilDay(d.dueDate).getTime());
  const due = dueDates.length > 0 ? Math.min(...dueDates) : Math.max(...docs.map((d) => civilDay(d.dueDate).getTime()));
  const today = civilDay(now).getTime();
  if (today <= due) return "invoiced";
  if (today <= due + noticeDays * DAY) return "overdue";
  return "suspended";
}

/** Echeance : fin d'essai (si posterieure a l'emission) + delai de paiement. */
export function dueDateFor(issuedOn: Date, trialEndsOn: Date | null, paymentTermDays: number): Date {
  const base = trialEndsOn && civilDay(trialEndsOn) > civilDay(issuedOn) ? trialEndsOn : issuedOn;
  return addDays(base, paymentTermDays);
}

export function formatMad(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Cellule CSV (separateur ";") : neutralise les formules (=, +, -, @) et echappe les guillemets. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type Issuer = { name: string; address: string; ice: string; if: string; rc: string; rib: string; bank: string };

/**
 * Identite legale ORYA lue dans l'environnement. AUCUN identifiant reel dans le depot : les valeurs
 * par defaut sont des EXEMPLES FICTIFS. En production, l'emission est refusee tant qu'une valeur
 * fictive subsiste (voir issuerIsFictitious).
 */
export function issuerFromEnv(env: NodeJS.ProcessEnv = process.env): Issuer {
  return {
    name: env.BILLING_ISSUER_NAME || "ORYA SARL (EXEMPLE FICTIF)",
    address: env.BILLING_ISSUER_ADDRESS || "1 rue Exemple, 10000 Rabat (ADRESSE FICTIVE)",
    ice: env.BILLING_ISSUER_ICE || "ICE-FICTIF-000000000000000",
    if: env.BILLING_ISSUER_IF || "IF-FICTIF-00000000",
    rc: env.BILLING_ISSUER_RC || "RC-FICTIF-00000",
    rib: env.BILLING_ISSUER_RIB || "RIB-FICTIF-000-000-0000000000000000-00",
    bank: env.BILLING_ISSUER_BANK || "BANQUE FICTIVE",
  };
}

export function issuerIsFictitious(issuer: Issuer): boolean {
  return Object.values(issuer).some((v) => /FICTI/i.test(v));
}