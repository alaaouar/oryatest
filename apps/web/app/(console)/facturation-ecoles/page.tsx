"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { describeError } from "@/lib/api";
import { formatDate } from "@/lib/labels";
import {
  BILLING_STATUS_LABEL,
  currentSchoolYear,
  DOC_KIND_LABEL,
  downloadAccountingCsv,
  downloadAdminInvoice,
  evaluateStatuses,
  formatMad,
  getBillingSchool,
  issueAnnual,
  issueComplementary,
  issueCreditNote,
  listBillingContracts,
  parseMad,
  previewAnnual,
  reconcilePayment,
  saveBillingContract,
  type AdminContractRow,
  type AdminSchoolDetail,
  type BillingPreview,
  type SchoolDocView,
} from "@/lib/school-billing";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Bloc 5 (Avenant n°1) : console de facturation des écoles, super-admin avec MFA.
 * Contrats, émission des factures et avoirs (documents immuables, numérotation sans trou),
 * rapprochement MANUEL des virements reçus (audité), export CSV pour l'expert-comptable.
 * Aucun paiement en ligne des parents, aucun prestataire de paiement.
 */
export default function SchoolBillingAdminPage() {
  const [rows, setRows] = useState<AdminContractRow[]>([]);
  const [detail, setDetail] = useState<AdminSchoolDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contract, setContract] = useState({ priceHt: "100,00", vatPercent: "20", trialEndsOn: "", paymentTermDays: "30", noticeDays: "15", referenceMonthDay: "10-31" });
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear());
  const [referenceDate, setReferenceDate] = useState("");
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [csv, setCsv] = useState({ from: "", to: "" });
  // t62u A2 : rapprochement par formulaire dans la page (plus de boites de dialogue navigateur).
  const [payFor, setPayFor] = useState<SchoolDocView | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", receivedOn: "", bankReference: "", note: "", confirmed: false });

  const loadList = useCallback(async () => {
    try {
      setRows(await listBillingContracts());
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  const loadDetail = useCallback(async (schoolId: string) => {
    try {
      const d = await getBillingSchool(schoolId);
      setDetail(d);
      const c = d.school.schoolContract;
      setContract({
        priceHt: c ? formatMad(c.unitPriceHtMinor, "").trim() : "100,00",
        vatPercent: c ? String(c.vatRateBp / 100) : "20",
        trialEndsOn: c?.trialEndsOn ? c.trialEndsOn.slice(0, 10) : "",
        paymentTermDays: String(c?.paymentTermDays ?? 30),
        noticeDays: String(c?.noticeDays ?? 15),
        referenceMonthDay: c?.referenceMonthDay ?? "10-31",
      });
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(label);
      await loadList();
      if (selectedId) await loadDetail(selectedId);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function select(id: string) {
    setSelectedId(id);
    setPreview(null);
    void loadDetail(id);
  }

  function saveContract() {
    if (!selectedId) return;
    const ht = parseMad(contract.priceHt);
    const vat = Number(contract.vatPercent.replace(",", "."));
    if (ht === null || !Number.isFinite(vat)) {
      setError("Prix HT ou TVA invalide.");
      return;
    }
    void run("Contrat enregistré (audité).", () =>
      saveBillingContract(selectedId, {
        unitPriceHtMinor: ht,
        vatRateBp: Math.round(vat * 100),
        trialEndsOn: contract.trialEndsOn || null,
        paymentTermDays: Number(contract.paymentTermDays),
        noticeDays: Number(contract.noticeDays),
        referenceMonthDay: contract.referenceMonthDay,
      }),
    );
  }

  function complement(doc: SchoolDocView) {
    const countDate = window.prompt("Date de comptage des élèves arrivés après la référence (AAAA-MM-JJ)", today());
    if (!countDate) return;
    const reason = window.prompt("Motif de la facture complémentaire", "Arrivées en cours d'année");
    if (!reason) return;
    void run("Facture complémentaire émise.", () => issueComplementary(doc.id, countDate, reason));
  }

  function credit(doc: SchoolDocView) {
    const quantity = Number(window.prompt("Nombre d'enfants à créditer", "1"));
    if (!Number.isInteger(quantity) || quantity < 1) return;
    const reason = window.prompt("Motif de l'avoir", "");
    if (!reason) return;
    if (!window.confirm(`Émettre un avoir de ${quantity} enfant(s) sur ${doc.number} ? Ce document sera définitif.`)) return;
    void run("Avoir émis.", () => issueCreditNote(doc.id, quantity, reason));
  }

  function openPay(doc: SchoolDocView) {
    setPayFor(doc);
    setPayForm({ amount: formatMad(doc.outstandingMinor, "").trim(), receivedOn: today(), bankReference: "", note: "", confirmed: false });
  }

  function submitPay(event: FormEvent) {
    event.preventDefault();
    if (!payFor) return;
    const amount = parseMad(payForm.amount);
    if (amount === null || amount <= 0) {
      setError("Montant invalide (ex. 360,00).");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payForm.receivedOn)) {
      setError("Date de réception invalide (AAAA-MM-JJ).");
      return;
    }
    if (payForm.bankReference.trim().length < 3) {
      setError("Référence bancaire obligatoire (3 caractères minimum).");
      return;
    }
    if (!payForm.confirmed) {
      setError("Cochez la confirmation : le rapprochement est audité et ne peut pas être modifié.");
      return;
    }
    const doc = payFor;
    const note = payForm.note.trim();
    void run("Virement rapproché (audité).", async () => {
      await reconcilePayment(doc.id, { amountMinor: amount, receivedOn: payForm.receivedOn, bankReference: payForm.bankReference.trim(), ...(note ? { note } : {}) });
      setPayFor(null);
    });
  }

  const c = detail?.school.schoolContract ?? null;
  return (
    <main className="page stack">
      <div>
        <h1 className="h1">Facturation des écoles</h1>
        <p className="subtitle">
          Avenant n°1 : l&apos;école collecte 120 DH TTC par enfant et par an et paie ORYA par un seul virement. Aucun paiement en ligne des parents, aucun prestataire de paiement.
        </p>
      </div>
      {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      {notice ? <div className="alert alert--ok" role="status">{notice}</div> : null}

      <section className="card card--flat stack">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void run("Statuts réévalués.", () => evaluateStatuses())}>Réévaluer les statuts</button>
          <label className="field"><span className="label">CSV du</span><input className="input" type="date" value={csv.from} onChange={(e) => setCsv({ ...csv, from: e.target.value })} /></label>
          <label className="field"><span className="label">au</span><input className="input" type="date" value={csv.to} onChange={(e) => setCsv({ ...csv, to: e.target.value })} /></label>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void run("Export CSV téléchargé (audité).", () => downloadAccountingCsv(csv.from || undefined, csv.to || undefined))}>Export CSV expert-comptable</button>
        </div>
        <table className="table" data-testid="billing-contracts">
          <thead><tr><th>École</th><th>Contrat</th><th>Statut</th><th>Prix TTC / enfant</th><th>Facturé</th><th>Avoirs</th><th>Encaissé</th><th>Solde</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}{r.city ? ` (${r.city})` : ""}</td>
                <td>{r.contract?.reference ?? "Aucun"}</td>
                <td>{r.contract ? BILLING_STATUS_LABEL[r.contract.status] : "-"}</td>
                <td>{r.contract ? formatMad(r.contract.unitPriceTtcMinor, r.contract.currency) : "-"}</td>
                <td>{formatMad(r.billedMinor)}</td>
                <td>{formatMad(r.creditedMinor)}</td>
                <td>{formatMad(r.paidMinor)}</td>
                <td>{formatMad(r.balanceMinor)}</td>
                <td><button type="button" className="btn btn--ghost" onClick={() => select(r.id)}>Ouvrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {detail ? (
        <>
          <section className="card card--flat stack">
            <h2 className="h2">{detail.school.name} : contrat {c ? `${c.reference}, ${BILLING_STATUS_LABEL[c.status]}` : "à créer"}</h2>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
              <label className="field"><span className="label">Prix HT / enfant (DH)</span><input className="input" value={contract.priceHt} onChange={(e) => setContract({ ...contract, priceHt: e.target.value })} /></label>
              <label className="field"><span className="label">TVA (%)</span><input className="input" value={contract.vatPercent} onChange={(e) => setContract({ ...contract, vatPercent: e.target.value })} /></label>
              <label className="field"><span className="label">Fin d&apos;essai</span><input className="input" type="date" value={contract.trialEndsOn} onChange={(e) => setContract({ ...contract, trialEndsOn: e.target.value })} /></label>
              <label className="field"><span className="label">Délai de paiement (j)</span><input className="input" type="number" min={1} max={365} value={contract.paymentTermDays} onChange={(e) => setContract({ ...contract, paymentTermDays: e.target.value })} /></label>
              <label className="field"><span className="label">Préavis avant suspension (j)</span><input className="input" type="number" min={0} max={365} value={contract.noticeDays} onChange={(e) => setContract({ ...contract, noticeDays: e.target.value })} /></label>
              <label className="field"><span className="label">Date de référence (MM-JJ)</span><input className="input" value={contract.referenceMonthDay} onChange={(e) => setContract({ ...contract, referenceMonthDay: e.target.value })} /></label>
              <button type="button" className="btn btn--primary" disabled={busy} onClick={saveContract}>{c ? "Mettre à jour le contrat" : "Créer le contrat"}</button>
            </div>
          </section>

          {c ? (
            <section className="card card--flat stack">
              <h2 className="h2">Facture annuelle</h2>
              <p className="muted">Enfants facturés : élèves inscrits et actifs à la date de référence (entrés au plus tard ce jour-là et non sortis ce jour-là ou avant).</p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
                <label className="field"><span className="label">Année scolaire</span><input className="input" value={schoolYear} onChange={(e) => setSchoolYear(e.target.value)} /></label>
                <label className="field"><span className="label">Date de référence (facultatif)</span><input className="input" type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} /></label>
                <button type="button" className="btn" disabled={busy} onClick={() => void previewAnnual(c.schoolId, schoolYear, referenceDate || undefined).then(setPreview).catch((e) => setError(describeError(e)))}>Aperçu</button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Émettre la facture annuelle ${schoolYear} ? Le document sera numéroté et définitif.`)) {
                      void run("Facture annuelle émise.", () => issueAnnual(c.schoolId, schoolYear, referenceDate || undefined));
                    }
                  }}
                >
                  Émettre
                </button>
              </div>
              {preview ? <p data-testid="billing-preview">Au {formatDate(preview.referenceDate)} : {preview.quantity} enfant(s), {formatMad(preview.totalHtMinor)} HT, TVA {formatMad(preview.totalVatMinor)}, total {formatMad(preview.totalTtcMinor)} TTC.</p> : null}
            </section>
          ) : null}

          <section className="card card--flat stack">
            <h2 className="h2">Documents et virements</h2>
            <p className="muted">Facturé {formatMad(detail.ledger.billedMinor)}, avoirs {formatMad(detail.ledger.creditedMinor)}, encaissé {formatMad(detail.ledger.paidMinor)}, solde {formatMad(detail.ledger.balanceMinor)}.</p>
            {detail.documents.length === 0 ? <p className="muted">Aucun document émis.</p> : (
              <table className="table" data-testid="billing-documents">
                <thead><tr><th>Numéro</th><th>Type</th><th>Émis le</th><th>Échéance</th><th>Enfants</th><th>TTC</th><th>Reste dû</th><th>Actions</th></tr></thead>
                <tbody>
                  {detail.documents.map((d) => (
                    <tr key={d.id}>
                      <td>{d.number}</td>
                      <td>{DOC_KIND_LABEL[d.kind]}</td>
                      <td>{formatDate(d.issuedAt)}</td>
                      <td>{d.kind === "credit_note" ? "-" : formatDate(d.dueDate)}</td>
                      <td>{d.quantity}</td>
                      <td>{formatMad(d.kind === "credit_note" ? -d.totalTtcMinor : d.totalTtcMinor, d.currency)}</td>
                      <td>{d.kind === "credit_note" ? "-" : formatMad(d.outstandingMinor, d.currency)}</td>
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" className="btn btn--ghost" onClick={() => void downloadAdminInvoice(d).catch((e) => setError(describeError(e)))}>PDF</button>
                        {d.kind === "invoice" ? <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => complement(d)}>Complément</button> : null}
                        {d.kind === "invoice" ? <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => credit(d)}>Avoir</button> : null}
                        {d.kind !== "credit_note" && d.outstandingMinor > 0 ? <button type="button" className="btn btn--teal" disabled={busy} onClick={() => openPay(d)}>Rapprocher un virement</button> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {payFor ? (
              <form className="card card--flat stack" data-testid="payment-form" aria-label={`Rapprochement d'un virement sur ${payFor.number}`} onSubmit={submitPay}>
                <h3 className="h2">Rapprocher un virement sur {payFor.number} (reste dû {formatMad(payFor.outstandingMinor, payFor.currency)})</h3>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
                  <label className="field"><span className="label">Montant reçu (DH)</span><input className="input" name="amount" inputMode="decimal" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required /></label>
                  <label className="field"><span className="label">Date de réception</span><input className="input" name="receivedOn" type="date" max={today()} value={payForm.receivedOn} onChange={(e) => setPayForm({ ...payForm, receivedOn: e.target.value })} required /></label>
                  <label className="field"><span className="label">Référence bancaire</span><input className="input" name="bankReference" value={payForm.bankReference} maxLength={120} onChange={(e) => setPayForm({ ...payForm, bankReference: e.target.value })} required /></label>
                  <label className="field"><span className="label">Note (facultatif)</span><input className="input" name="note" value={payForm.note} maxLength={500} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} /></label>
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="confirmed" checked={payForm.confirmed} onChange={(e) => setPayForm({ ...payForm, confirmed: e.target.checked })} />
                  <span>Je confirme ce rapprochement : il est audité et ne pourra pas être modifié.</span>
                </label>
                <div style={{ display: "flex", gap: 12 }}>
                  <button type="submit" className="btn btn--teal" disabled={busy}>Enregistrer le rapprochement</button>
                  <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setPayFor(null)}>Annuler</button>
                </div>
              </form>
            ) : null}
            {detail.payments.length > 0 ? (
              <table className="table" data-testid="billing-payments">
                <thead><tr><th>Reçu le</th><th>Montant</th><th>Référence bancaire</th></tr></thead>
                <tbody>
                  {detail.payments.map((p) => (
                    <tr key={p.id}><td>{formatDate(p.receivedOn)}</td><td>{formatMad(p.amountMinor)}</td><td>{p.bankReference}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}