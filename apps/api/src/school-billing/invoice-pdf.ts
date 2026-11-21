import { renderTextPdf } from "../privacy/pdf";
import { formatMad, isoDay, ttcOf, type Issuer } from "./billing-rules";

type PdfDoc = {
  kind: "invoice" | "complementary" | "credit_note";
  number: string;
  schoolYear: string;
  referenceDate: Date;
  issuedAt: Date;
  dueDate: Date;
  quantity: number;
  unitPriceHtMinor: number;
  vatRateBp: number;
  totalHtMinor: number;
  totalVatMinor: number;
  totalTtcMinor: number;
  currency: string;
  reason: string | null;
  issuer: unknown;
  client: unknown;
};

const TITLE: Record<PdfDoc["kind"], string> = {
  invoice: "FACTURE ANNUELLE",
  complementary: "FACTURE COMPLEMENTAIRE",
  credit_note: "AVOIR",
};

/** Bloc 5 : PDF d'un document emis (genere a la demande a partir des donnees immuables). */
export function renderInvoicePdf(doc: PdfDoc, relatedNumber: string | null): Buffer {
  const issuer = (doc.issuer ?? {}) as Partial<Issuer>;
  const client = (doc.client ?? {}) as { name?: string; city?: string; ice?: string | null; code?: string };
  const sign = doc.kind === "credit_note" ? -1 : 1;
  const lines = [
    `${TITLE[doc.kind]} N ${doc.number}`,
    `Date d'emission : ${isoDay(doc.issuedAt)}    Echeance : ${isoDay(doc.dueDate)}`,
    relatedNumber ? `Document lie : ${relatedNumber}` : "",
    "",
    "EMETTEUR",
    `${issuer.name ?? ""}`,
    `${issuer.address ?? ""}`,
    `ICE : ${issuer.ice ?? ""}   IF : ${issuer.if ?? ""}   RC : ${issuer.rc ?? ""}`,
    "",
    "CLIENT (etablissement scolaire)",
    `${client.name ?? ""} - ${client.city ?? ""} (code ${client.code ?? ""})`,
    `ICE : ${client.ice ?? "non renseigne"}`,
    "",
    `Objet : abonnement ORYA, annee scolaire ${doc.schoolYear}`,
    doc.kind === "credit_note"
      ? `Motif de l'avoir : ${doc.reason ?? ""}`
      : `Eleves actifs au ${isoDay(doc.referenceDate)} (date de reference) : ${doc.quantity}`,
    doc.kind === "complementary" ? `Motif : ${doc.reason ?? ""}` : "",
    "",
    `Quantite : ${doc.quantity} eleve(s)`,
    `Prix unitaire HT : ${formatMad(doc.unitPriceHtMinor)} ${doc.currency}`,
    `Prix unitaire TTC : ${formatMad(ttcOf(doc.unitPriceHtMinor, doc.vatRateBp))} ${doc.currency} par eleve et par an`,
    `Total HT : ${formatMad(sign * doc.totalHtMinor)} ${doc.currency}`,
    `TVA ${(doc.vatRateBp / 100).toFixed(2)} % : ${formatMad(sign * doc.totalVatMinor)} ${doc.currency}`,
    `TOTAL TTC : ${formatMad(sign * doc.totalTtcMinor)} ${doc.currency}`,
    "",
    "Reglement : UN virement bancaire de l'etablissement a ORYA (aucun paiement en ligne des familles).",
    `Banque : ${issuer.bank ?? ""}   RIB : ${issuer.rib ?? ""}`,
    `Reference a indiquer sur le virement : ${doc.number}`,
    "",
    "Document emis et numerote de facon continue ; il n'est jamais modifie (correction par avoir).",
  ].filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""));
  return renderTextPdf(`ORYA - ${TITLE[doc.kind]} ${doc.number}`, lines);
}