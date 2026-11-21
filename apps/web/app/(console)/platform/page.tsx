"use client";

import { useCallback, useEffect, useState } from "react";
import { createPlan, describeError, draftInvoice, getPlatformOverview, listPlans, takeUsageSnapshot, updatePlan, updateSubscription } from "@/lib/api";
import { formatBytes, formatDate, formatDateTime, formatLimit, SUBSCRIPTION_STATUS_LABEL } from "@/lib/labels";
import type { PlanView, PlatformOverview, PlatformSchoolRow, SubscriptionStatusValue } from "@/lib/types";

const STATUSES: SubscriptionStatusValue[] = ["trial", "active", "past_due", "suspended", "cancelled"];

function numOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

/** Lot 9 : console plateforme du super-admin (accès inter-écoles audité, MFA requis). */
export default function PlatformPage() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [plans, setPlans] = useState<PlanView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlatformSchoolRow | null>(null);
  const [form, setForm] = useState({ planId: "", status: "", trialEndsAt: "", reason: "" });
  const [planForm, setPlanForm] = useState({ code: "", name: "", maxStudents: "", maxStaff: "", trialDays: "" });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [o, p] = await Promise.all([getPlatformOverview(), listPlans()]);
      setData(o);
      setPlans(p);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(label: string, work: () => Promise<unknown>) {
    setError(null);
    setNotice(null);
    try {
      await work();
      setNotice(label);
      await load();
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  return (
    <main className="page stack">
      <div>
        <h1 className="h1">Plateforme ORYA</h1>
        <p className="subtitle">Écoles, abonnements, usage — chaque consultation et modification est journalisée</p>
      </div>
      {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      {notice ? <div className="alert" role="status">{notice}</div> : null}

      {data ? (
        <>
          <section className="grid">
            <article className="card"><p className="muted">Écoles</p><p className="h1">{data.totals.schools}</p><p className="muted">{Object.entries(data.bySubscription).map(([k, v]) => `${SUBSCRIPTION_STATUS_LABEL[k] ?? k} : ${v}`).join(" · ")}</p></article>
            <article className="card"><p className="muted">Élèves</p><p className="h1">{data.totals.students}</p></article>
            <article className="card"><p className="muted">Personnel / parents</p><p className="h1">{data.totals.staff} / {data.totals.parents}</p></article>
            <article className="card"><p className="muted">Paiement</p><p className="h2">{data.billingProvider.label}</p><p className="muted">Aucun encaissement réel</p></article>
          </section>

          {data.trialsEndingSoon.length ? (
            <div className="alert alert--warn">Essais se terminant sous 30 jours : {data.trialsEndingSoon.map((t) => `${t.name} (${formatDate(t.trialEndsAt)})`).join(", ")}</div>
          ) : null}

          <section className="card card--flat">
            <h2 className="h2">Écoles</h2>
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ marginTop: 12 }}>
                <thead><tr><th>École</th><th>Abonnement</th><th>Plan</th><th>Élèves</th><th>Personnel</th><th>Parents</th><th>Messages 30 j</th><th>Appels 30 j</th><th>Stockage</th><th>Dernière activité</th><th /></tr></thead>
                <tbody>
                  {data.schools.map((s) => (
                    <tr key={s.id}>
                      <td>{s.name} <span className="muted">{s.city} · <span className="mono">{s.code}</span></span></td>
                      <td>{SUBSCRIPTION_STATUS_LABEL[s.subscription?.status ?? "none"]}</td>
                      <td>{s.subscription?.plan?.name ?? "—"}</td>
                      <td>{s.usage.students} / {formatLimit(s.subscription?.plan?.maxStudents)}</td>
                      <td>{s.usage.staff} / {formatLimit(s.subscription?.plan?.maxStaff)}</td>
                      <td>{s.usage.parents}</td>
                      <td>{s.usage.messages30d}</td>
                      <td>{s.usage.sessions30d}</td>
                      <td>{formatBytes(s.usage.storageBytes)}</td>
                      <td>{s.usage.lastActivityAt ? formatDateTime(s.usage.lastActivityAt) : "—"}</td>
                      <td><button className="btn" type="button" onClick={() => { setSelected(s); setForm({ planId: "", status: "", trialEndsAt: "", reason: "" }); }}>Gérer</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {selected ? (
            <section className="card card--flat stack">
              <h2 className="h2">Abonnement — {selected.name}</h2>
              <form
                className="row"
                style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("Abonnement mis à jour.", () =>
                    updateSubscription(selected.id, {
                      ...(form.planId ? { planId: form.planId } : {}),
                      ...(form.status ? { status: form.status as SubscriptionStatusValue } : {}),
                      ...(form.trialEndsAt ? { trialEndsAt: form.trialEndsAt } : {}),
                      ...(form.reason ? { reason: form.reason } : {}),
                    }),
                  );
                }}
              >
                <div className="field"><label className="label" htmlFor="sub-plan">Plan</label>
                  <select id="sub-plan" className="input" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                    <option value="">(inchangé)</option>
                    {plans.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="field"><label className="label" htmlFor="sub-status">Statut</label>
                  <select id="sub-status" className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    <option value="">(inchangé)</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{SUBSCRIPTION_STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="field"><label className="label" htmlFor="sub-trial">Fin d&apos;essai</label><input id="sub-trial" className="input" type="date" value={form.trialEndsAt} onChange={(e) => setForm({ ...form, trialEndsAt: e.target.value })} /></div>
                <div className="field" style={{ minWidth: 220 }}><label className="label" htmlFor="sub-reason">Motif (obligatoire pour suspendre / résilier)</label><input id="sub-reason" className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={300} /></div>
                <button className="btn btn--primary" type="submit">Enregistrer</button>
              </form>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" type="button" onClick={() => void act("Instantané d'usage enregistré.", () => takeUsageSnapshot(selected.id))}>Instantané d&apos;usage</button>
                <button className="btn" type="button" onClick={() => { const end = new Date(); const start = new Date(end.getFullYear(), end.getMonth(), 1); void act("Brouillon de facture créé (montant à définir tant que le prix n'est pas fixé).", () => draftInvoice(selected.id, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))); }}>Brouillon de facture (mois en cours)</button>
              </div>
            </section>
          ) : null}

          <section className="card card--flat stack">
            <h2 className="h2">Plans</h2>
            <p className="muted">Noms, limites et prix sont des valeurs de travail à définir par Ayoub. Une limite vide n&apos;est pas appliquée.</p>
            <table className="table">
              <thead><tr><th>Plan</th><th>Élèves max</th><th>Personnel max</th><th>Essai (j)</th><th>Prix</th><th>Écoles</th><th /></tr></thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name} <span className="muted mono">{p.code}</span>{p.toBeDefined ? <span className="badge badge--pending" style={{ marginLeft: 6 }}>À définir</span> : null}</td>
                    <td>{formatLimit(p.maxStudents)}</td>
                    <td>{formatLimit(p.maxStaff)}</td>
                    <td>{formatLimit(p.trialDays)}</td>
                    <td>{p.priceMinor === null ? "À définir" : `${(p.priceMinor / 100).toLocaleString("fr-FR")} ${p.currency}`}</td>
                    <td>{p.subscriptions ?? 0}</td>
                    <td><button className="btn btn--ghost" type="button" onClick={() => void act(p.isActive ? "Plan désactivé." : "Plan réactivé.", () => updatePlan(p.id, { isActive: !p.isActive }))}>{p.isActive ? "Désactiver" : "Réactiver"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form
              className="row"
              style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}
              onSubmit={(e) => {
                e.preventDefault();
                void act("Plan créé.", async () => {
                  await createPlan({ code: planForm.code, name: planForm.name, maxStudents: numOrNull(planForm.maxStudents), maxStaff: numOrNull(planForm.maxStaff), trialDays: numOrNull(planForm.trialDays) });
                  setPlanForm({ code: "", name: "", maxStudents: "", maxStaff: "", trialDays: "" });
                });
              }}
            >
              <div className="field"><label className="label" htmlFor="pl-code">Code</label><input id="pl-code" className="input mono" value={planForm.code} onChange={(e) => setPlanForm({ ...planForm, code: e.target.value })} required pattern="[a-z0-9][a-z0-9-]{1,39}" /></div>
              <div className="field"><label className="label" htmlFor="pl-name">Nom</label><input id="pl-name" className="input" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} required /></div>
              <div className="field"><label className="label" htmlFor="pl-st">Élèves max</label><input id="pl-st" className="input" type="number" min={1} value={planForm.maxStudents} onChange={(e) => setPlanForm({ ...planForm, maxStudents: e.target.value })} /></div>
              <div className="field"><label className="label" htmlFor="pl-sf">Personnel max</label><input id="pl-sf" className="input" type="number" min={1} value={planForm.maxStaff} onChange={(e) => setPlanForm({ ...planForm, maxStaff: e.target.value })} /></div>
              <div className="field"><label className="label" htmlFor="pl-tr">Essai (jours)</label><input id="pl-tr" className="input" type="number" min={1} max={366} value={planForm.trialDays} onChange={(e) => setPlanForm({ ...planForm, trialDays: e.target.value })} /></div>
              <button className="btn btn--primary" type="submit">Créer le plan</button>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}
