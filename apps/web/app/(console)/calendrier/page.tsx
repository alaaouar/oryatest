"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { addHoliday, deleteHoliday, describeError, getSchoolCalendar, setWorkingDays } from "@/lib/api";
import { formatCivilDate } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { SchoolCalendarView } from "@/lib/types";

type Notice = { tone: "ok" | "error"; text: string } | null;

const DAYS: { value: number; label: string }[] = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 7, label: "Dimanche" },
];

/** t92 (CDC M2) : calendrier de l'établissement (jours ouvrés, vacances et jours fériés). */
export default function CalendarPage() {
  const profile = useActiveProfile();
  const isDirection = profile?.role === "direction";
  const allowed = isDirection || profile?.role === "teacher";

  const [calendar, setCalendar] = useState<SchoolCalendarView | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await getSchoolCalendar();
    setCalendar(data);
    setDays(data.workingDays);
  }, []);

  useEffect(() => {
    if (!allowed) return;
    load().catch((cause) => setNotice({ tone: "error", text: describeError(cause) }));
  }, [allowed, load]);

  async function saveDays() {
    setBusy(true);
    setNotice(null);
    try {
      const data = await setWorkingDays(days);
      setCalendar(data);
      setDays(data.workingDays);
      setNotice({ tone: "ok", text: "Jours ouvrés enregistrés." });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await addHoliday({ label: label.trim(), startDate, endDate: endDate || startDate });
      setLabel("");
      setStartDate("");
      setEndDate("");
      await load();
      setNotice({ tone: "ok", text: "Période ajoutée : pas d'appel ni de rappel ces jours-là." });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setBusy(true);
    setNotice(null);
    try {
      await deleteHoliday(id);
      await load();
      setNotice({ tone: "ok", text: "Période supprimée." });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">Cette page est réservée à l&apos;équipe de l&apos;établissement.</div>
      </main>
    );
  }

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Calendrier</h1>
          <p className="subtitle">
            Année {calendar?.schoolYear ?? "…"} · fuseau {calendar?.timezone ?? "Africa/Casablanca"}. L&apos;appel ne s&apos;ouvre pas un jour
            de vacances ; le rappel de 7h45 suit ce calendrier.
          </p>
        </div>
      </div>

      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}

      <section className="card stack">
        <h2 className="h2">Jours ouvrés</h2>
        {!calendar?.configured ? <p className="muted">Valeurs par défaut (lundi au samedi) : enregistrez le calendrier de l&apos;établissement.</p> : null}
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          {DAYS.map((day) => (
            <label key={day.value} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                disabled={!isDirection || busy}
                checked={days.includes(day.value)}
                onChange={(e) =>
                  setDays((current) => (e.target.checked ? [...current, day.value] : current.filter((d) => d !== day.value)))
                }
              />
              {day.label}
            </label>
          ))}
        </div>
        {isDirection ? (
          <div>
            <button className="btn btn--primary" type="button" disabled={busy || days.length === 0} onClick={() => void saveDays()}>
              Enregistrer les jours ouvrés
            </button>
          </div>
        ) : null}
      </section>

      <section className="card stack">
        <h2 className="h2">Vacances et jours fériés</h2>
        {calendar && calendar.holidays.length === 0 ? <p className="muted">Aucune période enregistrée.</p> : null}
        <ul className="list-reset stack" style={{ gap: 8 }}>
          {calendar?.holidays.map((holiday) => (
            <li key={holiday.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                <strong>{holiday.label}</strong> · {formatCivilDate(holiday.startDate)}
                {holiday.endDate !== holiday.startDate ? ` → ${formatCivilDate(holiday.endDate)}` : ""}
              </span>
              {isDirection ? (
                <button className="btn" type="button" disabled={busy} onClick={() => void onDelete(holiday.id)}>
                  Supprimer
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {isDirection ? (
          <form className="row" style={{ flexWrap: "wrap", gap: 12, alignItems: "flex-end" }} onSubmit={onAdd}>
            <div className="field">
              <label className="label" htmlFor="h-label">Libellé</label>
              <input id="h-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} minLength={2} maxLength={120} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="h-start">Du</label>
              <input id="h-start" className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="h-end">Au (inclus)</label>
              <input id="h-end" className="input" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <button className="btn btn--primary" type="submit" disabled={busy}>
              Ajouter la période
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
