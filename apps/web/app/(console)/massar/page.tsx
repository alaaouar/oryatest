"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { describeError, exportMassar, getMassarCheck, listMassarExports } from "@/lib/api";
import { addDays, formatDate, formatDateTime } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { MassarCheck, MassarExportRecord, MassarReport } from "@/lib/types";

const REPORTS: { id: MassarReport; label: string; period: boolean }[] = [
  { id: "students", label: "Élèves (identité, code Massar, classe)", period: false },
  { id: "enrollments", label: "Inscriptions de l'année", period: false },
  { id: "absences", label: "Absences et retards (détail par séance)", period: true },
  { id: "absence-totals", label: "Totaux d'absences par élève", period: true },
  { id: "anomalies", label: "Rapport d'anomalies", period: false },
];

function currentSchoolYear(today: string): string {
  const year = Number(today.slice(0, 4));
  return Number(today.slice(5, 7)) >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export default function MassarPage() {
  const profile = useActiveProfile();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date());
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear(today));
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [check, setCheck] = useState<MassarCheck | null>(null);
  const [history, setHistory] = useState<MassarExportRecord[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, h] = await Promise.all([getMassarCheck(schoolYear), listMassarExports()]);
      setCheck(c);
      setHistory(h);
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [schoolYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => (check ? check.anomalies.filter((a) => filter === "all" || a.code === filter) : []), [check, filter]);

  if (profile && profile.role !== "direction") {
    return <main className="page"><div className="alert alert--error">Réservé à la direction.</div></main>;
  }

  async function download(report: MassarReport, format: "csv" | "xlsx") {
    setBusy(`${report}.${format}`);
    setError(null);
    try {
      await exportMassar(report, format, schoolYear, from, to);
      setHistory(await listMassarExports());
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="page stack">
      <div>
        <h1 className="h1">Préparation Massar</h1>
        <p className="subtitle">Contrôle des données et exports au format ORYA compatible pour saisie Massar</p>
      </div>

      <div className="alert alert--warn" role="note">
        ORYA n&apos;est <strong>pas connecté à Massar</strong> et ne reproduit aucun format officiel. Les colonnes
        exportées sont une hypothèse de travail ({check?.columnsVersion ?? "orya-massar-v1"}), configurables, à
        vérifier avec votre établissement avant toute saisie dans Massar.
      </div>

      {error ? <div className="alert alert--error" role="alert">{error}</div> : null}

      <form className="card card--flat row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="field">
          <label className="label" htmlFor="massar-year">Année scolaire</label>
          <input id="massar-year" className="input mono" value={schoolYear} pattern="\d{4}-\d{4}" onChange={(e) => setSchoolYear(e.target.value)} required />
        </div>
        <button className="btn" type="submit">Relancer le contrôle</button>
      </form>

      {check ? (
        <>
          <section className="grid">
            <article className="card"><p className="muted">Élèves</p><p className="h1">{check.totals.students}</p><p className="muted">{check.totals.enrolled} inscrits en {check.schoolYear}</p></article>
            <article className="card"><p className="muted">Avec code Massar</p><p className="h1">{check.totals.withMassar}</p><p className="muted">Format attendu : <span className="mono">{check.massarPattern}</span></p></article>
            <article className="card"><p className="muted">Prêts (sans anomalie bloquante)</p><p className="h1">{check.totals.ready}</p></article>
            <article className="card"><p className="muted">Anomalies</p><p className="h1">{check.totals.errors + check.totals.warnings}</p><p className="muted">{check.totals.errors} bloquante(s) · {check.totals.warnings} à vérifier</p></article>
          </section>

          <section className="card card--flat">
            <h2 className="h2">Anomalies</h2>
            {check.anomalies.length === 0 ? (
              <p className="muted" style={{ marginTop: 8 }}>Aucune anomalie détectée pour {check.schoolYear}.</p>
            ) : (
              <>
                <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <button type="button" className={`btn ${filter === "all" ? "btn--primary" : ""}`} onClick={() => setFilter("all")}>Toutes ({check.anomalies.length})</button>
                  {Object.entries(check.byCode).filter(([, n]) => n > 0).map(([code, n]) => (
                    <button key={code} type="button" className={`btn ${filter === code ? "btn--primary" : ""}`} onClick={() => setFilter(code)}>{check.labels[code] ?? code} ({n})</button>
                  ))}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="table" style={{ marginTop: 12 }}>
                    <thead><tr><th>Gravité</th><th>Élève</th><th>Code Massar</th><th>Détail</th></tr></thead>
                    <tbody>
                      {shown.map((a, index) => (
                        <tr key={`${a.studentId}-${a.code}-${index}`}>
                          <td><span className={`badge ${a.severity === "error" ? "badge--absent" : "badge--pending"}`}>{a.severity === "error" ? "Bloquant" : "À vérifier"}</span></td>
                          <td><Link href={`/students/${a.studentId}`}>{a.displayName}</Link> <span className="muted mono">{a.studentCode}</span></td>
                          <td className="mono">{a.massarCode ?? "—"}</td>
                          <td>{a.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted" style={{ marginTop: 8 }}>Corrigez depuis la fiche élève. Un code Massar enregistré n&apos;est jamais remplacé par un import.</p>
              </>
            )}
          </section>

          <section className="card card--flat">
            <h2 className="h2">Exports</h2>
            <div className="row" style={{ gap: 12, flexWrap: "wrap", marginTop: 12 }}>
              <div className="field"><label className="label" htmlFor="m-from">Absences du</label><input id="m-from" className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className="field"><label className="label" htmlFor="m-to">au</label><input id="m-to" className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            <ul className="list-reset stack" style={{ gap: 8, marginTop: 12 }}>
              {REPORTS.map((r) => (
                <li key={r.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span>{r.label}{r.period ? <span className="muted"> · {formatDate(from)} → {formatDate(to)}</span> : null}</span>
                  <span className="row" style={{ gap: 8 }}>
                    {(["csv", "xlsx"] as const).map((format) => (
                      <button key={format} type="button" className="btn" disabled={busy !== null} onClick={() => void download(r.id, format)}>
                        {busy === `${r.id}.${format}` ? "…" : format.toUpperCase()}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted" style={{ marginTop: 8 }}>Cellules protégées contre l&apos;injection de formules. Chaque export est journalisé avec son empreinte SHA-256.</p>
          </section>
        </>
      ) : null}

      <section className="card card--flat">
        <h2 className="h2">Historique des exports</h2>
        {history.length === 0 ? (
          <p className="muted" style={{ marginTop: 8 }}>Aucun export réalisé.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ marginTop: 12 }}>
              <thead><tr><th>Date</th><th>Rapport</th><th>Format</th><th>Lignes</th><th>Anomalies</th><th>Empreinte</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDateTime(h.createdAt)}</td>
                    <td>{REPORTS.find((r) => r.id === h.report)?.label ?? h.report} <span className="muted">{h.schoolYear}{h.from ? ` · ${formatDate(h.from)} → ${formatDate(h.to)}` : ""}</span></td>
                    <td>{h.format.toUpperCase()}</td>
                    <td>{h.rowCount}</td>
                    <td>{h.anomalyCount}</td>
                    <td className="mono" title={h.sha256}>{h.sha256.slice(0, 12)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
