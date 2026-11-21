"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, describeError, exportDashboard, getDashboard } from "@/lib/api";
import { addDays, formatDate, formatDateTime } from "@/lib/labels";
import type { DashboardReport, DashboardSummary } from "@/lib/types";

const REPORT_LABEL: Record<DashboardReport, string> = {
  classes: "Effectifs par classe",
  today: "Appel du jour",
  teachers: "Activité enseignants",
  unjustified: "Absences non justifiées",
  activity: "Activité par jour",
  communications: "Communications",
};

function pct(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("fr-FR")} %`;
}

function Kpi({ label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string }) {
  const body = (
    <>
      <p className="muted direction-dashboard__kpi-label">{label}</p>
      <p className="h1 direction-dashboard__kpi-value">{value}</p>
      {hint ? <p className="muted direction-dashboard__kpi-hint">{hint}</p> : null}
    </>
  );
  return (
    <article className="card direction-dashboard__kpi" data-clickable={href ? "true" : undefined}>
      {href ? <Link className="direction-dashboard__kpi-link" href={href}>{body}</Link> : body}
    </article>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted" style={{ marginTop: 8 }}>{children}</p>;
}

type TabKey = "overview" | "attendance" | "classes" | "alerts" | "exports";

/** Lot 7 : tableau de bord direction, chiffres issus des requêtes réelles de l'école. */
export function DirectionDashboard() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date());
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [daysPreset, setDaysPreset] = useState<number>(30);
  const [tab, setTab] = useState<TabKey>("overview");
  const [classQuery, setClassQuery] = useState("");
  const [teacherQuery, setTeacherQuery] = useState("");
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getDashboard(from, to));
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 403 ? "Second facteur requis pour le tableau de bord." : describeError(caught));
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(report: DashboardReport, format: "csv" | "xlsx") {
    setExporting(`${report}.${format}`);
    try {
      await exportDashboard(report, format, from, to);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setExporting(null);
    }
  }

  const maxDay = data ? Math.max(1, ...data.activity.days.map((d) => d.present + d.absent + d.late)) : 1;
  const totalTodayMarked = data ? data.today.present + data.today.absent + data.today.late : 0;
  const attendanceRate = totalTodayMarked > 0 && data ? ((data.today.present / totalTodayMarked) * 100).toFixed(1) : null;

  const filteredClasses = data ? data.classes.filter(c => c.name.toLowerCase().includes(classQuery.toLowerCase()) || (c.level ?? "").toLowerCase().includes(classQuery.toLowerCase())) : [];
  const filteredTeachers = data ? data.teachers.filter(t => t.name.toLowerCase().includes(teacherQuery.toLowerCase())) : [];

  return (
    <section className="stack direction-dashboard">
      {/* Barre de contrôle interactive : Sélecteur de période rapide */}
      <div className="card direction-dashboard__filters">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--marine)" }}>Période :</span>
            {[
              { days: 1, label: "Aujourd'hui" },
              { days: 7, label: "7 jours" },
              { days: 30, label: "30 jours" },
              { days: 90, label: "Ce trimestre (90j)" },
            ].map((p) => {
              const active = daysPreset === p.days;
              return (
                <button
                  key={p.days}
                  className="direction-dashboard__preset"
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setDaysPreset(p.days);
                    setTo(today);
                    setFrom(addDays(today, -(p.days - 1)));
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <form
            className="direction-dashboard__date-filter"
            onSubmit={(e) => {
              e.preventDefault();
              setDaysPreset(0);
              void load();
            }}
          >
            <input
              type="date"
              className="input direction-dashboard__date"
              value={from}
              max={to}
              onChange={(e) => { setFrom(e.target.value); setDaysPreset(0); }}
            />
            <span className="muted">à</span>
            <input
              type="date"
              className="input direction-dashboard__date"
              value={to}
              min={from}
              onChange={(e) => { setTo(e.target.value); setDaysPreset(0); }}
            />
            <button className="btn btn--outline direction-dashboard__filter-submit" type="submit">
              Filtrer
            </button>
          </form>
        </div>
      </div>

      {error ? <div className="alert alert--error" role="alert">{error}</div> : null}
      {loading && !data ? <p className="muted">Chargement du tableau de bord…</p> : null}

      {data ? (
        <>
          {/* Onglets interactifs style Udemy */}
          <div className="direction-dashboard__tabs" role="tablist" aria-label="Sections du tableau de bord">
            {[
              { id: "overview", label: "Vue d'ensemble", icon: "/data.svg" },
              { id: "attendance", label: "Appel & Séances", icon: "/checklist.svg", count: data.today.sessions.opened },
              { id: "classes", label: "Classes & Équipe", icon: "/school.svg", count: data.classes.length },
              { id: "alerts", label: "Alertes & Justificatifs", icon: "/danger.svg", count: data.unjustified.total + data.pending.justifications },
              { id: "exports", label: "Exports & Rapports", icon: "/import.svg", count: 6 },
            ].map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id as TabKey)}
                  className="direction-dashboard__tab"
                >
                  {t.icon.startsWith("/") ? (
                    <Image src={t.icon} alt="" aria-hidden width={18} height={18} className="svg-icon" />
                  ) : (
                    <span>{t.icon}</span>
                  )}
                  <span>{t.label}</span>
                  {typeof t.count === "number" && t.count > 0 ? (
                    <span
                      className="direction-dashboard__tab-count"
                    >
                      {t.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* CONTENU ONGLETS */}

          {/* 1. Vue d'ensemble */}
          {tab === "overview" ? (
            <div className="stack" style={{ gap: 20 }}>
              <section className="grid">
                <Kpi label="Élèves inscrits" value={data.students.total} hint={`${data.students.enrolled} actifs en ${data.schoolYear}${data.students.unassigned ? ` · ${data.students.unassigned} sans classe` : ""}`} href="/students" />
                <Kpi label="Absences non justifiées" value={data.unjustified.total} hint={data.unjustified.total ? `${data.unjustified.students} élève(s) sur la période` : "Aucune anomalie"} />
                <Kpi label="Justificatifs en attente" value={data.pending.justifications} hint={data.pending.oldestJustificationAt ? `Plus ancien : ${formatDate(data.pending.oldestJustificationAt)}` : "Tous traités"} href="/justifications" />
                <Kpi label="Actions familles" value={data.pending.actionsOpen} hint={data.pending.actionsOverdue ? `${data.pending.actionsOverdue} en retard` : "À jour"} />
              </section>

              {/* Jauge visuelle de présence */}
              <section className="card" style={{ border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <h2 className="h2" style={{ fontWeight: 800 }}>Taux de présence globale aujourd&apos;hui</h2>
                    <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{formatDate(data.today.date)} · Base des séances clôturées et en cours</p>
                  </div>
                  {attendanceRate !== null ? (
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                      <span style={{ fontSize: 32, fontWeight: 800, color: Number(attendanceRate) >= 90 ? "#137333" : "#b4690e" }}>
                        {attendanceRate}%
                      </span>
                      <span className="muted" style={{ fontSize: 12 }}>de présence</span>
                    </div>
                  ) : null}
                </div>

                {totalTodayMarked > 0 ? (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: "flex", height: 14, borderRadius: 8, overflow: "hidden", background: "rgba(0,0,0,0.06)", gap: 2 }}>
                      <div style={{ width: `${(data.today.present / totalTodayMarked) * 100}%`, background: "#1aa99a", transition: "width 0.5s ease" }} title={`${data.today.present} présents`} />
                      <div style={{ width: `${(data.today.late / totalTodayMarked) * 100}%`, background: "#d4a017", transition: "width 0.5s ease" }} title={`${data.today.late} retards`} />
                      <div style={{ width: `${(data.today.absent / totalTodayMarked) * 100}%`, background: "#e05a4f", transition: "width 0.5s ease" }} title={`${data.today.absent} absents`} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12 }}>
                      <span style={{ color: "#0c5f56", fontWeight: 700 }}>● {data.today.present} Présents ({totalTodayMarked ? Math.round((data.today.present / totalTodayMarked) * 100) : 0}%)</span>
                      <span style={{ color: "#7a5b07", fontWeight: 700 }}>● {data.today.late} Retards ({totalTodayMarked ? Math.round((data.today.late / totalTodayMarked) * 100) : 0}%)</span>
                      <span style={{ color: "#9e2f26", fontWeight: 700 }}>● {data.today.absent} Absents ({totalTodayMarked ? Math.round((data.today.absent / totalTodayMarked) * 100) : 0}%)</span>
                    </div>
                  </div>
                ) : (
                  <Empty>Aucune séance clôturée avec présence enregistrée aujourd&apos;hui.</Empty>
                )}
              </section>

              {/* Communications */}
              <section className="card">
                <h2 className="h2" style={{ fontWeight: 800 }}>Communications & Engagements</h2>
                {data.communications.sent === 0 ? (
                  <Empty>Aucun message envoyé sur la période.</Empty>
                ) : (
                  <div className="grid" style={{ marginTop: 14, gap: 12 }}>
                    <div style={{ padding: 14, background: "var(--cream)", borderRadius: 6, border: "1px solid var(--line)" }}>
                      <span className="muted" style={{ fontSize: 12 }}>Messages transmis</span>
                      <p style={{ fontSize: 24, fontWeight: 800, margin: "4px 0 0" }}>{data.communications.sent}</p>
                    </div>
                    <div style={{ padding: 14, background: "var(--cream)", borderRadius: 6, border: "1px solid var(--line)" }}>
                      <span className="muted" style={{ fontSize: 12 }}>Taux de lecture parents</span>
                      <p style={{ fontSize: 24, fontWeight: 800, margin: "4px 0 0", color: "var(--purple-deep)" }}>{pct(data.communications.readRate)}</p>
                    </div>
                    <div style={{ padding: 14, background: "var(--cream)", borderRadius: 6, border: "1px solid var(--line)" }}>
                      <span className="muted" style={{ fontSize: 12 }}>Accusés de réception</span>
                      <p style={{ fontSize: 24, fontWeight: 800, margin: "4px 0 0", color: "#1aa99a" }}>{pct(data.communications.ackRate)}</p>
                    </div>
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {/* 2. Appel & Séances */}
          {tab === "attendance" ? (
            <div className="stack" style={{ gap: 20 }}>
              <section className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h2 className="h2" style={{ fontWeight: 800 }}>Séances d&apos;appel du {formatDate(data.today.date)}</h2>
                    <p className="muted" style={{ fontSize: 13 }}>Suivi temps réel des classes</p>
                  </div>
                  <Link href="/attendance" className="btn btn--primary" style={{ minHeight: 36, fontSize: 13 }}>
                    Ouvrir l&apos;appel
                  </Link>
                </div>

                <div className="stats" style={{ marginTop: 16 }}>
                  <span className="stat">{data.today.sessions.opened} séance(s) ouverte(s)</span>
                  <span className="stat"><span className="dot dot--present" /> {data.today.present} présents</span>
                  <span className="stat"><span className="dot dot--absent" /> {data.today.absent} absents</span>
                  <span className="stat"><span className="dot dot--late" /> {data.today.late} retards</span>
                  <span className="stat" style={{ color: data.today.classesWithoutSession > 0 ? "var(--late)" : "inherit" }}>
                    {data.today.classesWithoutSession} classe(s) sans appel
                  </span>
                </div>
              </section>

              {/* Historique d'activité par jour */}
              <section className="card">
                <h2 className="h2" style={{ fontWeight: 800 }}>Activité quotidienne sur la période</h2>
                {!data.activity.hasData ? (
                  <Empty>Aucune séance enregistrée sur cette période.</Empty>
                ) : (
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Séances</th>
                          <th style={{ minWidth: 140 }}>Présences</th>
                          <th>Absents</th>
                          <th>Retards</th>
                          <th>Messages</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.activity.days.filter((d) => d.sessions > 0).reverse().map((d) => {
                          const marked = d.present + d.absent + d.late;
                          return (
                            <tr key={d.date}>
                              <td style={{ fontWeight: 600 }}>{formatDate(d.date)}</td>
                              <td>{d.closed}/{d.sessions}</td>
                              <td>
                                {marked ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ flex: 1, height: 6, background: "rgba(0,0,0,0.08)", borderRadius: 4, overflow: "hidden" }}>
                                      <div style={{ width: `${Math.max(6, (d.present / marked) * 100)}%`, background: "var(--teal)", height: "100%" }} />
                                    </div>
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>{Math.round((d.present / marked) * 100)}%</span>
                                  </div>
                                ) : "—"}
                              </td>
                              <td style={{ color: d.absent > 0 ? "var(--absent)" : "inherit", fontWeight: d.absent > 0 ? 700 : 400 }}>{d.absent}</td>
                              <td style={{ color: d.late > 0 ? "var(--late)" : "inherit" }}>{d.late}</td>
                              <td>{d.messages}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {/* 3. Classes & Équipe */}
          {tab === "classes" ? (
            <div className="stack" style={{ gap: 20 }}>
              {/* Classes avec filtre dynamique */}
              <section className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <h2 className="h2" style={{ fontWeight: 800 }}>Effectifs par classe ({filteredClasses.length})</h2>
                    <p className="muted" style={{ fontSize: 13 }}>Répartition des effectifs</p>
                  </div>
                  <input
                    type="search"
                    className="input"
                    placeholder="Filtrer une classe ou un niveau…"
                    value={classQuery}
                    onChange={(e) => setClassQuery(e.target.value)}
                    style={{ minHeight: 36, fontSize: 13, maxWidth: 240 }}
                  />
                </div>

                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table className="table">
                    <thead>
                      <tr><th>Classe</th><th>Niveau</th><th style={{ textAlign: "right" }}>Inscrits</th></tr>
                    </thead>
                    <tbody>
                      {filteredClasses.map((entry) => (
                        <tr key={entry.id}>
                          <td style={{ fontWeight: 700 }}>{entry.name}</td>
                          <td><span className="badge badge--muted">{entry.level ?? "Général"}</span></td>
                          <td style={{ textAlign: "right", fontWeight: 700 }}>{entry.students} élèves</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Activité Enseignants avec filtre dynamique */}
              <section className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <h2 className="h2" style={{ fontWeight: 800 }}>Activité de l&apos;équipe pédagogique ({filteredTeachers.length})</h2>
                    <p className="muted" style={{ fontSize: 13 }}>Séances, devoirs et messages publiés</p>
                  </div>
                  <input
                    type="search"
                    className="input"
                    placeholder="Filtrer un enseignant…"
                    value={teacherQuery}
                    onChange={(e) => setTeacherQuery(e.target.value)}
                    style={{ minHeight: 36, fontSize: 13, maxWidth: 240 }}
                  />
                </div>

                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Enseignant</th>
                        <th>Appels ouverts</th>
                        <th>Appels clôturés</th>
                        <th>Devoirs publiés</th>
                        <th>Messages</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTeachers.map((entry) => (
                        <tr key={entry.name}>
                          <td style={{ fontWeight: 700 }}>{entry.name}</td>
                          <td>{entry.sessionsOpened}</td>
                          <td><span className="badge badge--active">{entry.sessionsClosed}</span></td>
                          <td>{entry.agendaPublished}</td>
                          <td>{entry.messagesSent}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}

          {/* 4. Alertes & Absences */}
          {tab === "alerts" ? (
            <div className="stack" style={{ gap: 20 }}>
              <section className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h2 className="h2" style={{ fontWeight: 800 }}>Absences et retards sans justificatif ({data.unjustified.total})</h2>
                    <p className="muted" style={{ fontSize: 13 }}>Nécessite un suivi avec les parents</p>
                  </div>
                  <Link href="/justifications" className="btn btn--outline" style={{ minHeight: 36, fontSize: 13 }}>
                    Examiner les justificatifs
                  </Link>
                </div>

                {data.unjustified.total === 0 ? (
                  <Empty>Excellente assiduité : aucune anomalie en attente.</Empty>
                ) : (
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table className="table">
                      <thead>
                        <tr><th>Date & Créneau</th><th>Élève</th><th>Classe</th><th>Statut</th></tr>
                      </thead>
                      <tbody>
                        {data.unjustified.recent.map((row, index) => (
                          <tr key={`${row.studentId}-${row.date}-${row.slot}-${index}`}>
                            <td>{formatDate(row.date)} · <span className="muted">{row.slot === "morning" ? "Matin" : "Après-midi"}</span></td>
                            <td><Link href={`/students/${row.studentId}`} style={{ fontWeight: 700, color: "var(--purple-deep)" }}>{row.student}</Link></td>
                            <td><span className="badge badge--muted">{row.classroom}</span></td>
                            <td>
                              <span className={`badge ${row.status === "absent" ? "badge--absent" : "badge--late"}`}>
                                {row.status === "absent" ? "Absence non justifiée" : "Retard"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          ) : null}

          {/* 5. Exports & Rapports */}
          {tab === "exports" ? (
            <div className="stack" style={{ gap: 20 }}>
              <section className="card">
                <h2 className="h2" style={{ fontWeight: 800 }}>Rapports et Téléchargements</h2>
                <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                  Téléchargez les données certifiées pour l&apos;inspection ou l&apos;export Massar. Protection contre l&apos;injection de formules active.
                </p>

                <div className="grid" style={{ marginTop: 16, gap: 14 }}>
                  {(Object.keys(REPORT_LABEL) as DashboardReport[]).map((report) => (
                    <div
                      key={report}
                      style={{
                        padding: 16,
                        border: "1px solid var(--line)",
                        borderRadius: "var(--radius)",
                        background: "var(--surface)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--marine)" }}>{REPORT_LABEL[report]}</div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                          Période du {formatDate(data.range.from)} au {formatDate(data.range.to)}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        {(["csv", "xlsx"] as const).map((format) => (
                          <button
                            key={format}
                            type="button"
                            className="btn btn--outline"
                            style={{ flex: 1, minHeight: 34, fontSize: 12 }}
                            disabled={exporting !== null}
                            onClick={() => void download(report, format)}
                          >
                            {exporting === `${report}.${format}` ? "Téléchargement…" : format.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
