"use client";

import { useEffect, useState } from "react";
import { describeError, getSchoolBilling } from "@/lib/api";
import { formatDate, formatLimit, SUBSCRIPTION_STATUS_LABEL } from "@/lib/labels";
import type { SchoolBilling } from "@/lib/types";
import { SchoolBillingSection } from "./school-billing-section";

/** Lot 9 : abonnement de l'établissement (direction, lecture seule). */
export default function BillingPage() {
  const [data, setData] = useState<SchoolBilling | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSchoolBilling().then(setData).catch((caught) => setError(describeError(caught)));
  }, []);

  const sub = data?.subscription;
  const plan = sub?.planRef;
  return (
    <main className="page stack">
      <div>
        <h1 className="h1">Abonnement</h1>
        <p className="subtitle">Plan, limites et usage de votre établissement</p>
      </div>
      <SchoolBillingSection />
      {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      {data ? (
        <>
          {sub && ["suspended", "cancelled", "expired"].includes(sub.status) ? (
            <div className="alert alert--warn" role="status"> en lecture seule ({SUBSCRIPTION_STATUS_LABEL[sub.status]}). Contactez ORYA.</div>
          ) : null}
          <section className="grid">
            <article className="card"><p className="muted">Statut</p><p className="h2">{SUBSCRIPTION_STATUS_LABEL[sub?.status ?? "none"]}</p>{sub?.trialEndsAt ? <p className="muted">Fin d&apos;essai : {formatDate(sub.trialEndsAt)}</p> : null}</article>
            <article className="card"><p className="muted">Plan</p><p className="h2">{plan?.name ?? "Aucun plan attribué"}</p>{plan?.toBeDefined ? <p className="muted">Conditions à définir par ORYA</p> : null}</article>
            <article className="card"><p className="muted">Élèves</p><p className="h2">{data.usage.students} / {formatLimit(plan?.maxStudents)}</p></article>
            <article className="card"><p className="muted">Comptes personnel (dont invitations)</p><p className="h2">{data.usage.staff} / {formatLimit(plan?.maxStaff)}</p></article>
          </section>
          <section className="card card--flat">
            <h2 className="h2">Factures</h2>
            {data.invoices.length === 0 ? (
              <p className="muted" style={{ marginTop: 8 }}>Aucune facture.</p>
            ) : (
              <table className="table" style={{ marginTop: 12 }}>
                <thead><tr><th>Période</th><th>Statut</th><th>Montant</th></tr></thead>
                <tbody>
                  {data.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>{formatDate(inv.periodStart)} → {formatDate(inv.periodEnd)}</td>
                      <td>{inv.status === "draft" ? "Brouillon" : inv.status === "issued" ? "Émise" : "Annulée"}</td>
                      <td>{inv.amountMinor === null ? "À définir" : `${(inv.amountMinor / 100).toLocaleString("fr-FR")} ${inv.currency}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted" style={{ marginTop: 8 }}>Paiement en ligne : {data.billingProvider.label}. Aucun prélèvement n&apos;est effectué par ORYA à ce stade.</p>
          </section>
        </>
      ) : null}
    </main>
  );
}
