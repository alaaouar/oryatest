/**
 * Bloc 5 (Avenant n°1) : facturation des écoles par ORYA. L'école collecte 120 DH TTC par enfant
 * et par an auprès des familles et paie ORYA par UN virement annuel. Aucun paiement en ligne des
 * parents, aucun prestataire de paiement. Écritures : super-admin avec MFA (auditées).
 */
import { downloadPrivateFile, get, patch, post } from "./api";

export type SchoolBillingStatus = "trial" | "invoiced" | "paid" | "overdue" | "suspended";
export type SchoolDocKind = "invoice" | "complementary" | "credit_note";

export const BILLING_STATUS_LABEL: Record<SchoolBillingStatus, string> = {
  trial: "Essai",
  invoiced: "Facturé",
  paid: "Payé",
  overdue: "En retard",
  suspended: "Suspendu (lecture seule)",
};

export const DOC_KIND_LABEL: Record<SchoolDocKind, string> = {
  invoice: "Facture annuelle",
  complementary: "Facture complémentaire",
  credit_note: "Avoir",
};

export type SchoolContractView = {
  id: string;
  schoolId: string;
  reference: string;
  unitPriceHtMinor: number;
  vatRateBp: number;
  unitPriceTtcMinor: number;
  currency: string;
  status: SchoolBillingStatus;
  trialEndsOn: string | null;
  paymentTermDays: number;
  noticeDays: number;
  referenceMonthDay: string;
  statusChangedAt: string | null;
};

export type SchoolDocView = {
  id: string;
  kind: SchoolDocKind;
  number: string;
  schoolYear: string;
  referenceDate: string;
  issuedAt: string;
  dueDate: string;
  quantity: number;
  unitPriceHtMinor: number;
  vatRateBp: number;
  totalHtMinor: number;
  totalVatMinor: number;
  totalTtcMinor: number;
  currency: string;
  relatedInvoiceId: string | null;
  reason: string | null;
  outstandingMinor: number;
};

export type SchoolPaymentView = { id: string; invoiceId: string; amountMinor: number; receivedOn: string; bankReference: string; note?: string | null };
export type LedgerView = { billedMinor: number; creditedMinor: number; paidMinor: number; balanceMinor: number };

export type DirectionBillingView = {
  contract: SchoolContractView | null;
  readOnly: boolean;
  documents: SchoolDocView[];
  payments: SchoolPaymentView[];
  ledger: LedgerView;
  transfer: { beneficiary: string; bank: string; rib: string; note: string };
};

export type AdminContractRow = {
  id: string;
  name: string;
  city: string | null;
  code: string;
  contract: SchoolContractView | null;
  billedMinor: number;
  creditedMinor: number;
  paidMinor: number;
  balanceMinor: number;
  documents: number;
};

export type AdminSchoolDetail = {
  school: { id: string; name: string; city: string | null; code: string; ice: string | null; schoolContract: SchoolContractView | null };
  documents: SchoolDocView[];
  payments: SchoolPaymentView[];
  ledger: LedgerView;
};

export type BillingPreview = { schoolYear: string; referenceDate: string; quantity: number; totalHtMinor: number; totalVatMinor: number; totalTtcMinor: number };

const enc = encodeURIComponent;

/** 12000 -> "120,00 MAD" (centimes de dirham). */
export function formatMad(minor: number, currency = "MAD"): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100).toLocaleString("fr-FR")},${String(abs % 100).padStart(2, "0")} ${currency}`;
}

/** "120,50" ou "120.5" -> 12050 ; null si invalide. */
export function parseMad(value: string): number | null {
  const v = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  return Math.round(Number(v) * 100);
}

export function currentSchoolYear(now = new Date()): string {
  const y = now.getFullYear();
  return now.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// ---- Direction (lecture seule + PDF) ----
export function getDirectionBilling(): Promise<DirectionBillingView> {
  return get<DirectionBillingView>("/billing/school");
}
export function downloadDirectionInvoice(doc: { id: string; number: string }): Promise<void> {
  return downloadPrivateFile(`/billing/school/invoices/${enc(doc.id)}/pdf`, `${doc.number}.pdf`);
}

// ---- Super-admin (MFA, audité) ----
export async function listBillingContracts(): Promise<AdminContractRow[]> {
  return (await get<{ schools: AdminContractRow[] }>("/admin/billing/contracts")).schools;
}
export function getBillingSchool(schoolId: string): Promise<AdminSchoolDetail> {
  return get<AdminSchoolDetail>(`/admin/billing/schools/${enc(schoolId)}`);
}
export function saveBillingContract(
  schoolId: string,
  input: { unitPriceHtMinor?: number; vatRateBp?: number; trialEndsOn?: string | null; paymentTermDays?: number; noticeDays?: number; referenceMonthDay?: string },
): Promise<SchoolContractView> {
  return patch<SchoolContractView>(`/admin/billing/schools/${enc(schoolId)}/contract`, input);
}
export function previewAnnual(schoolId: string, schoolYear: string, referenceDate?: string): Promise<BillingPreview> {
  const q = new URLSearchParams({ schoolYear });
  if (referenceDate) q.set("referenceDate", referenceDate);
  return get<BillingPreview>(`/admin/billing/schools/${enc(schoolId)}/preview?${q.toString()}`);
}
export function issueAnnual(schoolId: string, schoolYear: string, referenceDate?: string) {
  return post<{ invoice: SchoolDocView; status: SchoolBillingStatus | null }>(`/admin/billing/schools/${enc(schoolId)}/invoices`, referenceDate ? { schoolYear, referenceDate } : { schoolYear });
}
export function issueComplementary(invoiceId: string, countDate: string, reason: string) {
  return post<{ invoice: SchoolDocView; status: SchoolBillingStatus | null }>(`/admin/billing/invoices/${enc(invoiceId)}/complementary`, { countDate, reason });
}
export function issueCreditNote(invoiceId: string, quantity: number, reason: string) {
  return post<{ invoice: SchoolDocView; status: SchoolBillingStatus | null }>(`/admin/billing/invoices/${enc(invoiceId)}/credit-notes`, { quantity, reason });
}
export function reconcilePayment(invoiceId: string, input: { amountMinor: number; receivedOn: string; bankReference: string; note?: string }) {
  return post<{ payment: SchoolPaymentView; status: SchoolBillingStatus | null }>(`/admin/billing/invoices/${enc(invoiceId)}/payments`, input);
}
export function evaluateStatuses() {
  return post<{ asOf: string; changes: { schoolId: string; from: SchoolBillingStatus; to: SchoolBillingStatus }[] }>("/admin/billing/evaluate", {});
}
export function downloadAdminInvoice(doc: { id: string; number: string }): Promise<void> {
  return downloadPrivateFile(`/admin/billing/invoices/${enc(doc.id)}/pdf`, `${doc.number}.pdf`);
}
export function downloadAccountingCsv(from?: string, to?: string): Promise<void> {
  const q = new URLSearchParams();
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  const s = q.toString();
  return downloadPrivateFile(`/admin/billing/export.csv${s ? `?${s}` : ""}`, `orya-factures-${from || "debut"}-${to || "fin"}.csv`);
}

