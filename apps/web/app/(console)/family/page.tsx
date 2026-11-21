"use client";

import Image from "next/image";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  completeAction,
  describeError,
  downloadPrivateFile,
  getChildBus,
  getChildResults,
  getMyChild,
  getParentChildTrip,
  shareParentLocation,
  type ParentChildTripView,
  listMyActionCards,
  completeJustification,
  listMyChildren,
  listMyJustifications,
  submitJustification,
} from "@/lib/api";
import { todayInMorocco } from "@/lib/labels";
import { civilDate, LocaleSwitch, useI18n } from "@/lib/i18n";
import { useActiveProfile } from "@/lib/session";
import type { BusHistory } from "@/lib/api";
import type { ChildDetail, ChildSummary, Justification, ParentActionView, PublishedResult } from "@/lib/types";
import { LiveBusMap } from "@/components/LiveBusMap";
import { InteractiveLocationPicker } from "@/components/InteractiveLocationPicker";

type Tab = "children" | "justifications" | "actions" | "transport";
type Notice = { tone: "ok" | "error"; text: string } | null;

const MAX_FILE_BYTES = 5_000_000;

/** Lot 4 : espace parent, mobile d'abord, limité aux enfants rattachés au compte. */
export default function FamilyPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "parent";
  const { locale, setLocale, t, dir } = useI18n();

  const [tab, setTab] = useState<Tab>("children");
  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [detail, setDetail] = useState<ChildDetail | null>(null);
  const [justifications, setJustifications] = useState<Justification[]>([]);
  const [actions, setActions] = useState<ParentActionView[]>([]);
  const [hiddenOpen, setHiddenOpen] = useState(0);
  const [completeText, setCompleteText] = useState<Record<string, string>>({});
  const [completeFile, setCompleteFile] = useState<Record<string, File | null>>({});
  const [bus, setBus] = useState<BusHistory | null>(null);
  const [results, setResults] = useState<PublishedResult[]>([]);
  const [liveTransport, setLiveTransport] = useState<ParentChildTripView | null>(null);
  const [loadingTransport, setLoadingTransport] = useState(false);

  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    getChildBus(detail.id)
      .then((b) => { if (!cancelled) setBus(b); })
      .catch(() => { if (!cancelled) setBus(null); });
    // t92 (CDC M7) : résultats publiés de l'enfant affiché.
    getChildResults(detail.id)
      .then((r) => { if (!cancelled) setResults(r.items); })
      .catch(() => { if (!cancelled) setResults([]); });
    if (tab === "transport") {
      setLoadingTransport(true);
      getParentChildTrip(detail.id)
        .then((t) => { if (!cancelled) setLiveTransport(t); })
        .catch(() => { if (!cancelled) setLiveTransport(null); })
        .finally(() => { if (!cancelled) setLoadingTransport(false); });
    }
    return () => { cancelled = true; };
  }, [detail, tab]);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [formChild, setFormChild] = useState("");
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locationMessage, setLocationMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const handleSaveLocation = async (coords: {
    latitude: number;
    longitude: number;
    address?: string;
    relocateDemoSchool?: boolean;
  }) => {
    if (!detail) return;
    setBusy(true);
    setLocationMessage(null);
    try {
      const res = await shareParentLocation(detail.id, coords);
      const updated = await getParentChildTrip(detail.id);
      setLiveTransport(updated);
      setShowLocationPicker(false);
      setLocationMessage({
        tone: "ok",
        text: res.message || "Emplacement du domicile enregistré avec succès ! Le chauffeur du bus dispose désormais de vos coordonnées GPS exactes.",
      });
    } catch (cause) {
      setLocationMessage({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  };
  const [fromDate, setFromDate] = useState(todayInMorocco());
  const [toDate, setToDate] = useState(todayInMorocco());
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    try {
      const [childList, justificationList, actionList] = await Promise.all([
        listMyChildren(),
        listMyJustifications(),
        listMyActionCards(),
      ]);
      setChildren(childList);
      setJustifications(justificationList);
      setActions(actionList.actions);
      setHiddenOpen(actionList.hiddenOpen);
      setFormChild((current) => current || childList[0]?.id || "");
      const focus = childList[0];
      if (focus) {
        setDetail(await getMyChild(focus.id));
      }
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function openChild(childId: string) {
    setNotice(null);
    try {
      setDetail(await getMyChild(childId));
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    }
  }

  function startJustify(childId: string, date: string) {
    setFormChild(childId);
    setFromDate(date.slice(0, 10));
    setToDate(date.slice(0, 10));
    setTab("justifications");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (file && file.size > MAX_FILE_BYTES) {
      setNotice({ tone: "error", text: t("file_too_big") });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await submitJustification({
        studentId: formChild,
        fromDate,
        toDate,
        reason: reason.trim(),
        file: file ?? undefined,
      });
      setReason("");
      setFile(null);
      setNotice({ tone: "ok", text: t("justification_sent") });
      setJustifications(await listMyJustifications());
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function onDone(action: ParentActionView) {
    setBusy(true);
    setNotice(null);
    try {
      await completeAction(action.id);
      const cards = await listMyActionCards();
      setActions(cards.actions);
      setHiddenOpen(cards.hiddenOpen);
      setNotice({ tone: "ok", text: t("action_thanks") });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  /** t92 M4 : complément d'un justificatif « à compléter » (précision et/ou pièce). */
  async function onComplete(entry: Justification) {
    const text = (completeText[entry.id] ?? "").trim();
    const extra = completeFile[entry.id] ?? null;
    if (!text && !extra) {
      setNotice({ tone: "error", text: t("complete_need") });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await completeJustification(entry.id, { reason: text || undefined, file: extra ?? undefined });
      setCompleteText((m) => ({ ...m, [entry.id]: "" }));
      setCompleteFile((m) => ({ ...m, [entry.id]: null }));
      setNotice({ tone: "ok", text: t("complete_sent") });
      await load();
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function onDownload(entry: Justification) {
    try {
      await downloadPrivateFile(`/family/justifications/${entry.id}/file`, entry.file?.name ?? "justificatif");
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    }
  }

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">{t("parents_only")}</div>
      </main>
    );
  }

  const openActions = actions.filter((action) => action.status === "open");

  return (
    <main className="page stack parent-space" dir={dir} lang={locale}>
      <div className="page-head">
        <div>
          <h1 className="h1">{t("family_title")}</h1>
          <p className="subtitle">{t("family_subtitle")}</p>
        </div>
        {/* <LocaleSwitch locale={locale} setLocale={setLocale} label={t("lang_switch")} /> */}
      </div>

      <div className="seg seg--full" role="tablist" aria-label={t("sections")}>
        <button type="button" role="tab" className="seg__btn" aria-selected={tab === "children"} onClick={() => setTab("children")}>
          {t("tab_children")}
        </button>
        <button type="button" role="tab" className="seg__btn" aria-selected={tab === "justifications"} onClick={() => setTab("justifications")}>
          {t("tab_justifications")}
        </button>
        <button type="button" role="tab" className="seg__btn" aria-selected={tab === "actions"} onClick={() => setTab("actions")}>
          {t("tab_actions")}{openActions.length > 0 ? ` (${openActions.length})` : ""}
        </button>
        <button type="button" role="tab" className="seg__btn" aria-selected={tab === "transport"} onClick={() => setTab("transport")}>
          <Image src="/bus.svg" alt="" aria-hidden width={18} height={18} className="svg-icon svg-icon--inline" />
          {t("tab_transport")}
        </button>
      </div>

      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}
      {loading ? <p className="muted">{t("loading")}</p> : null}
      {!loading && children.length === 0 ? (
        <p className="muted">{t("no_child")}</p>
      ) : null}

      {tab === "children" ? (
        <>
          <div className="class-grid">
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                className="class-card"
                aria-pressed={detail?.id === child.id}
                onClick={() => void openChild(child.id)}
              >
                <div className="class-card__name">{child.displayName}</div>
                <div className="muted">{child.classroom ?? t("no_classroom")}</div>
                <div>
                  <span className="dot dot--absent" /> {child.attendance.absent} {t("n_absences")} · <span className="dot dot--late" />{" "}
                  {child.attendance.late} {t("n_lates")}
                </div>
              </button>
            ))}
          </div>

          {detail ? (
            <section className="card stack">
              <h2 className="h2">
                {detail.displayName} · {detail.schoolYear}
              </h2>
              <div className="stats">
                <div className="stat">
                  <span className="dot dot--present" /> {detail.attendance.present} {t("n_presents")}
                </div>
                <div className="stat">
                  <span className="dot dot--absent" /> {detail.attendance.absent} {t("n_absences")}
                </div>
                <div className="stat">
                  <span className="dot dot--late" /> {detail.attendance.late} {t("n_lates")}
                </div>
              </div>
              <div className="stack" data-testid="child-results">
                <strong>{t("results")}</strong>
                {results.length === 0 ? <p className="muted">{t("no_data")}</p> : null}
                <ul className="list-reset parent-list">
                  {results.map((r) => (
                    <li key={r.assessmentId} className="parent-list__item">
                      <div>
                        <strong>{r.subject}</strong> · {r.title}
                        <div className="muted">{civilDate(locale, r.date)}</div>
                      </div>
                      <span>{r.absent ? t("result_absent") : `${r.score} / ${r.maxScore}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="stat" data-testid="child-bus">
                {t("bus_today")} : {bus?.today ? t(`bus_${bus.today.status}`) : t("no_data")}
              </div>
              {detail.recentUnjustified > 0 ? (
                <div className="alert alert--warn">
                  {detail.recentUnjustified} {t("recent_unjustified")}
                </div>
              ) : null}
              {detail.recent.length === 0 ? (
                <p className="muted">{t("no_attendance")}</p>
              ) : (
                <ul className="list-reset parent-list">
                  {detail.recent.map((row, index) => (
                    <li key={`${row.date}-${row.slot}-${index}`} className="parent-list__item">
                      <div>
                        <div>{civilDate(locale, row.date)}</div>
                        <div className="muted">
                          {t(`slot_${row.slot}`)} · {t(`st_${row.status}`)}
                        </div>
                      </div>
                      {row.status === "present" ? null : row.justified ? (
                        <span className="badge badge--active">{t("justified")}</span>
                      ) : (
                        <button className="btn" type="button" onClick={() => startJustify(detail.id, row.date)}>
                          {t("justify")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {tab === "justifications" ? (
        <>
          {children.length > 0 ? (
            <form className="card stack" onSubmit={(event) => void onSubmit(event)}>
              <h2 className="h2">{t("send_justification")}</h2>
              <div className="field">
                <label className="label" htmlFor="j-child">
                  {t("child")}
                </label>
                <select id="j-child" className="select" value={formChild} onChange={(e) => setFormChild(e.target.value)} required>
                  {children.map((child) => (
                    <option key={child.id} value={child.id}>
                      {child.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <div className="field">
                  <label className="label" htmlFor="j-from">
                    {t("from")}
                  </label>
                  <input id="j-from" type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} required />
                </div>
                <div className="field">
                  <label className="label" htmlFor="j-to">
                    {t("to")}
                  </label>
                  <input id="j-to" type="date" className="input" value={toDate} min={fromDate} onChange={(e) => setToDate(e.target.value)} required />
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="j-reason">
                  {t("reason")}
                </label>
                <textarea id="j-reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={1000} required />
              </div>
              <div className="field">
                <label className="label" htmlFor="j-file">
                  {t("attachment_label")}
                </label>
                <input
                  id="j-file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <button className="btn btn--primary btn--block" type="submit" disabled={busy || !formChild}>
                {t("send")}
              </button>
            </form>
          ) : null}

          <section className="card stack">
            <h2 className="h2">{t("my_submissions")}</h2>
            {justifications.length === 0 ? <p className="muted">{t("no_justification")}</p> : null}
            <ul className="list-reset parent-list">
              {justifications.map((entry) => (
                <li key={entry.id} className="parent-list__item">
                  <div>
                    <div>
                      <strong>{entry.student.displayName}</strong> · {civilDate(locale, entry.fromDate)}
                      {entry.toDate !== entry.fromDate ? ` → ${civilDate(locale, entry.toDate)}` : ""}
                    </div>
                    <div className="muted">{entry.reason}</div>
                    {entry.reviewNote ? <div className="muted">{t("school_note")} {entry.reviewNote}</div> : null}
                    {entry.file ? (
                      <button className="btn btn--ghost" type="button" onClick={() => void onDownload(entry)}>
                        {t("attachment")}
                      </button>
                    ) : null}
                    {entry.status === "incomplete" ? (
                      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                        <label className="label" htmlFor={`c-${entry.id}`}>{t("complete_title")}</label>
                        <textarea
                          id={`c-${entry.id}`}
                          className="input"
                          rows={2}
                          maxLength={1000}
                          placeholder={t("complete_reason")}
                          value={completeText[entry.id] ?? ""}
                          onChange={(e) => setCompleteText((m) => ({ ...m, [entry.id]: e.target.value }))}
                        />
                        <input
                          className="input"
                          type="file"
                          aria-label={t("attachment")}
                          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                          onChange={(e) => setCompleteFile((m) => ({ ...m, [entry.id]: e.target.files?.[0] ?? null }))}
                        />
                        <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void onComplete(entry)}>
                          {t("complete_send")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <span
                    className={`badge ${entry.status === "accepted" ? "badge--active" : entry.status === "rejected" ? "badge--absent" : "badge--pending"}`}
                  >
                    {t(`j_${entry.status}`)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {tab === "actions" ? (
        <section className="card stack">
          <h2 className="h2">{t("school_requests")}</h2>
          {actions.length === 0 ? <p className="muted">{t("no_request")}</p> : null}
          <ul className="list-reset parent-list">
            {actions.map((action) => (
              <li key={action.id} className="parent-list__item">
                <div>
                  <div>
                    <strong>{action.title}</strong>
                  </div>
                  <div className="muted">
                    {action.student.displayName}
                    {action.dueDate ? ` · ${t("due_before")} ${civilDate(locale, action.dueDate)}` : ""}
                  </div>
                  {action.description ? <div>{action.description}</div> : null}
                </div>
                {action.status === "open" && action.justificationId &&
                justifications.some((j) => j.id === action.justificationId && j.status === "incomplete") ? (
                  <span className="muted" style={{ maxWidth: 260 }}>{t("card_via_justification")}</span>
                ) : action.status === "open" ? (
                  <button className="btn btn--teal" type="button" disabled={busy} onClick={() => void onDone(action)}>
                    {t("done")}
                  </button>
                ) : (
                  <span className="badge badge--active">{t("done_badge")}</span>
                )}
              </li>
            ))}
          </ul>
          {hiddenOpen > 0 ? (
            <p className="muted">
              {t("hidden_actions")} {hiddenOpen}
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === "transport" ? (
        <section className="family-transport" aria-labelledby="heading-transport">
          {children.length > 1 ? (
            <div className="seg seg--scroll" role="tablist" aria-label={t("tab_children")}>
              {children.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  className="seg__btn"
                  aria-selected={detail?.id === c.id}
                  onClick={() => void openChild(c.id)}
                >
                  {c.displayName}
                </button>
              ))}
            </div>
          ) : null}

          {loadingTransport ? (
            <div className="card family-transport__empty">
              <p className="muted">{t("loading")}</p>
            </div>
          ) : !liveTransport?.enrolled ? (
            <div className="card family-transport__empty">
              <Image src="/map.svg" alt="" aria-hidden width={42} height={42} className="svg-icon" />
              <h3>Pas de transport scolaire actif</h3>
              <p className="muted">
                {detail?.displayName ?? "Cet élève"} n&apos;est pas encore inscrit à un circuit de transport scolaire pour cette année. Contactez l&apos;administration de l&apos;établissement si vous souhaitez souscrire à ce service.
              </p>
            </div>
          ) : (
            <>
              {/* Carte d'information du circuit */}
              <div className="card family-transport__summary">
                <div>
                  <div className="family-transport__label">
                    Ligne de transport
                  </div>
                  <h3 className="family-transport__value">
                    {liveTransport.circuit?.name ?? "Circuit scolaire"}
                  </h3>
                </div>

                <div>
                  <div className="family-transport__label">
                    Arrêt de dépose / ramassage
                  </div>
                  <div className="family-transport__value family-transport__value--stop">
                    <Image src="/map.svg" alt="" aria-hidden width={18} height={18} className="svg-icon" />
                    {liveTransport.assignedStop?.name ?? "Arrêt personnalisé"}
                  </div>
                </div>

                {liveTransport.trip?.vehicle ? (
                  <div>
                    <div className="family-transport__label">
                      Véhicule
                    </div>
                    <div className="family-transport__value family-transport__value--vehicle">
                      <Image src="/bus.svg" alt="" aria-hidden width={18} height={18} className="svg-icon" />
                      {liveTransport.trip.vehicle.plateNumber}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Panneau de partage de la position du domicile (pour le chauffeur) */}
              <div className="card stack" style={{ border: "1.5px solid #e0e7ff", background: "#f8faff", padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1e1b4b", display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
                      <span>📍</span> Emplacement du domicile pour le ramassage
                    </h3>
                    <p className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 0 }}>
                      {liveTransport.assignedStop?.latitude && liveTransport.assignedStop?.longitude
                        ? "La position de votre maison est enregistrée. Le chauffeur dispose de votre localisation exacte pour les tournées."
                        : "Partagez la position de votre domicile en 1 clic pour que le chauffeur du bus sache exactement où récupérer et déposer votre enfant."}
                    </p>
                  </div>

                  {liveTransport.assignedStop?.latitude && liveTransport.assignedStop?.longitude ? (
                    <span className="badge badge--active" style={{ fontSize: 12, padding: "4px 10px" }}>
                      ✓ Domicile localisé
                    </span>
                  ) : (
                    <span className="badge badge--pending" style={{ fontSize: 12, padding: "4px 10px" }}>
                      En attente de localisation
                    </span>
                  )}
                </div>

                {locationMessage ? (
                  <div className={`alert alert--${locationMessage.tone}`} style={{ fontSize: 13, margin: 0 }}>
                    {locationMessage.text}
                  </div>
                ) : null}

                {/* État actuel de l'arrêt */}
                {liveTransport.assignedStop?.latitude && liveTransport.assignedStop?.longitude && !showLocationPicker ? (
                  <div style={{ background: "#ffffff", padding: "12px 14px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 13 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <div><strong>Arrêt / Repère :</strong> {liveTransport.assignedStop.address || liveTransport.assignedStop.name}</div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          Coordonnées : {liveTransport.assignedStop.latitude.toFixed(5)}, {liveTransport.assignedStop.longitude.toFixed(5)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn--sm"
                        style={{ background: "#f1f5f9" }}
                        onClick={() => setShowLocationPicker(true)}
                      >
                        ✏️ Modifier / Préciser mon domicile sur la carte
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Bouton de partage initial si non renseigné */}
                {!showLocationPicker && (!liveTransport.assignedStop?.latitude || !liveTransport.assignedStop?.longitude) ? (
                  <div>
                    <button
                      type="button"
                      className="btn btn--primary"
                      style={{ background: "var(--teal, #12A7A0)", color: "#ffffff", display: "inline-flex", alignItems: "center", gap: 8 }}
                      onClick={() => setShowLocationPicker(true)}
                    >
                      📍 Définir mon domicile sur la carte (GPS ou recherche)
                    </button>
                  </div>
                ) : null}

                {/* Sélecteur de position interactif avec carte, recherche & GPS */}
                {showLocationPicker ? (
                  <InteractiveLocationPicker
                    initialLat={liveTransport.assignedStop?.latitude ?? undefined}
                    initialLng={liveTransport.assignedStop?.longitude ?? undefined}
                    initialAddress={liveTransport.assignedStop?.address ?? undefined}
                    busy={busy}
                    onSave={handleSaveLocation}
                    onCancel={() => setShowLocationPicker(false)}
                  />
                ) : null}
              </div>

              {/* Carte Interactive en Direct */}
              <LiveBusMap
                schoolLocation={liveTransport.schoolLocation}
                assignedStop={liveTransport.assignedStop}
                trip={liveTransport.trip}
                studentName={detail?.displayName}
              />

              {/* Notice Légale CNDP / Loi 09-08 */}
              <div className="family-transport__privacy">
                <strong>
                  <Image src="/lock.svg" alt="" aria-hidden width={16} height={16} className="svg-icon svg-icon--inline" />
                  Protection des données personnelles (Loi 09-08 / CNDP) :
                </strong>{" "}
                {liveTransport.notice}
              </div>
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}
