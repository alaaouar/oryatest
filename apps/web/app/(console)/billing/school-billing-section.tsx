"use client";

import { useEffect, useState } from "react";
import { describeError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import {
  BILLING_STATUS_LABEL,
  DOC_KIND_LABEL,
  downloadDirectionInvoice,
  formatMad,
  getDirectionBilling,
  type DirectionBillingView,
} from "@/lib/school-billing";

/**
 * Bloc 5 (Avenant n°1) : la direction consulte SON contrat ORYA, ses factures et avoirs, son statut
 * et télécharge les PDF. Lecture seule : aucune action de paiement (virement bancaire hors ligne).
 */
export function SchoolBillingSection() {
  const [data, setData] = useState<DirectionBillingView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDirectionBilling().then(setData).catch((caught) => setError(describeError(caught)));
  }, []);

  async function download(doc: { id: string; number: string }) {
    setError(null);
    try {
      await downloadDirectionInvoice(doc);
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  const c = data?.contract ?? null;
  return (
    <section className="card card--flat stack" data-testid="school-billing">
      <div>
        <h2 className="h2">Facturation ORYA (Avenant n°1)</h2>
        <p className="muted">
          L&apos;établissement collecte la participation des familles et règle ORYA par un seul virement annuel. Aucun paiement en ligne n&apos;est demandé aux parents.
        </p>
      </div>
      {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      {data && data.readOnly ? (
        <div className="alert alert--warn" role="status" data-testid="billing-readonly">
          Établissement suspendu : lecture seule. Vos données restent visibles. L&apos;export des données, la suppression de compte, le retrait d&apos;un consentement et la sécurité des comptes restent disponibles.
        </div>
      ) : null}
      {data && !c ? <p className="muted">Aucun contrat de facturation n&apos;est encore établi pour votre établissement.</p> : null}
      {c ? (
        <div className="grid">
          <article className="card"><p className="muted">Statut</p><p className="h2" data-testid="billing-status">{BILLING_STATUS_LABEL[c.status]}</p></article>
          <article className="card"><p className="muted">Contrat</p><p className="h2">{c.reference}</p></article>
          <article className="card">
            <p className="muted">Prix par enfant et par an</p>
            <p className="h2">{formatMad(c.unitPriceTtcMinor, c.currency)} TTC</p>
            <p className="muted">{formatMad(c.unitPriceHtMinor, c.currency)} HT, TVA {(c.vatRateBp / 100).toLocaleString("fr-FR")} %</p>
          </article>
          <article className="card">
            <p className="muted">Solde dû</p>
            <p className="h2">{formatMad(Math.max(0, data?.ledger.balanceMinor ?? 0), c.currency)}</p>
            <p className="muted">Délai de paiement : {c.paymentTermDays} j{c.trialEndsOn ? ` ; fin d'essai : ${formatDate(c.trialEndsOn)}` : ""}</p>
          </article>
        </div>
      ) : null}
      {data && data.documents.length > 0 ? (
        <table className="table">
          <thead><tr><th>Numéro</th><th>Type</th><th>Émise le</th><th>Échéance</th><th>Enfants</th><th>Total TTC</th><th>Reste dû</th><th>PDF</th></tr></thead>
          <tbody>
            {data.documents.map((d) => (
              <tr key={d.id}>
                <td>{d.number}</td>
                <td>{DOC_KIND_LABEL[d.kind]}</td>
                <td>{formatDate(d.issuedAt)}</td>
                <td>{d.kind === "credit_note" ? "-" : formatDate(d.dueDate)}</td>
                <td>{d.quantity}</td>
                <td>{formatMad(d.kind === "credit_note" ? -d.totalTtcMinor : d.totalTtcMinor, d.currency)}</td>
                <td>{d.kind === "credit_note" ? "-" : formatMad(d.outstandingMinor, d.currency)}</td>
                <td><button type="button" className="btn btn--ghost" onClick={() => void download(d)}>Télécharger</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : data && c ? <p className="muted">Aucune facture émise.</p> : null}
      {data && c ? (
        <p className="muted">
          Virement : {data.transfer.beneficiary}, {data.transfer.bank}, {data.transfer.rib}. Indiquez le numéro de facture en référence du virement.
        </p>
      ) : null}
    </section>
  );
}