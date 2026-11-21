"use client";

import { useEffect, useState } from "react";
import { describeError, studentApi, type BusHistory, type StudentMe } from "@/lib/api";
import { LocaleSwitch, useI18n } from "@/lib/i18n";
import { formatCivilDate } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import { AiOrientationAssistant } from "@/components/AiOrientationAssistant";

type Data = {
  me: StudentMe;
  agenda: Awaited<ReturnType<typeof studentApi.agenda>>["items"];
  attendance: Awaited<ReturnType<typeof studentApi.attendance>>["items"];
  justifications: Awaited<ReturnType<typeof studentApi.justifications>>["items"];
  bus: BusHistory;
  notifications: Awaited<ReturnType<typeof studentApi.notifications>>["items"];
  results: Awaited<ReturnType<typeof studentApi.results>>["items"];
};

/** Bloc 4 : espace eleve, consultation seule ; refuse par l'API sans consentement parental actif. */
export default function StudentPage() {
  const profile = useActiveProfile();
  const { locale, setLocale, t, dir } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.role !== "student") return;
    Promise.all([studentApi.me(), studentApi.agenda(), studentApi.attendance(), studentApi.justifications(), studentApi.bus(), studentApi.notifications(), studentApi.results()])
      .then(([me, agenda, attendance, justifications, bus, notifications, results]) =>
        setData({ me, agenda: agenda.items, attendance: attendance.items, justifications: justifications.items, bus, notifications: notifications.items, results: results.items }),
      )
      .catch((e: unknown) => setError(describeError(e)));
  }, [profile?.role]);

  return (
    <main className="page stack" dir={dir} lang={locale} data-testid="student-space">
      <div className="page-head">
        <div>
          <h1 className="h1">{t("student_title")}</h1>
          <p className="subtitle">
            {data ? `${data.me.displayName}${data.me.classroom ? ` - ${data.me.classroom.name}` : ""} - ` : ""}
            {t("student_subtitle")}
          </p>
        </div>
        {/* <LocaleSwitch locale={locale} setLocale={setLocale} label={t("lang_switch")} /> */}
      </div>
      {error ? <div className="alert alert--error">{t("suspended")}</div> : null}
      {data ? (
        <>
          <section className="card stack" data-testid="student-info">
            <h2 className="h2">{t("student_info")}</h2>
            {data.notifications.length === 0 ? <p className="muted">{t("no_data")}</p> : null}
            <ul className="list-reset parent-list">
              {data.notifications.map((n) => (
                <li key={n.id} className="parent-list__item">
                  <div>
                    <strong>{n.title}</strong>
                    {n.body ? <div className="muted">{n.body}</div> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <AiOrientationAssistant
            studentName={data.me.displayName}
            initialClass={data.me.classroom?.name ?? "Mon Niveau"}
            grades={data.results
              .filter((r) => !r.absent && r.score !== null)
              .map((r) => ({ subject: r.subject, score20: (r.score! / r.maxScore) * 20 }))}
          />
          <section className="card stack" data-testid="student-results">
            <h2 className="h2">{t("results")}</h2>
            {data.results.length === 0 ? <p className="muted">{t("no_data")}</p> : null}
            <ul className="list-reset parent-list">
              {data.results.map((r) => (
                <li key={r.assessmentId} className="parent-list__item">
                  <div>
                    <strong>{r.subject}</strong> · {r.title}
                    <div className="muted">{formatCivilDate(r.date)}</div>
                  </div>
                  <span>{r.absent ? t("result_absent") : `${r.score} / ${r.maxScore}`}</span>
                </li>
              ))}
            </ul>
          </section>
          <AiOrientationAssistant
            studentName={data.me.displayName}
            initialClass={data.me.classroom?.name ?? "Mon Niveau"}
            grades={data.results
              .filter((r) => !r.absent && r.score !== null)
              .map((r) => ({ subject: r.subject, score20: (r.score! / r.maxScore) * 20 }))}
          />
          <section className="card stack">
            <h2 className="h2">{t("bus_today")}</h2>
            <p data-testid="student-bus">{data.bus.today ? t(`bus_${data.bus.today.status}`) : t("no_data")}</p>
          </section>
          <section className="card stack">
            <h2 className="h2">{t("agenda")}</h2>
            {data.agenda.length === 0 ? <p className="muted">{t("no_data")}</p> : null}
            <ul className="list-reset parent-list">
              {data.agenda.map((i) => (
                <li key={i.id} className="parent-list__item">
                  <div>
                    <strong>{i.title}</strong>
                    <div className="muted">{formatCivilDate(i.date)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <AiOrientationAssistant
            studentName={data.me.displayName}
            initialClass={data.me.classroom?.name ?? "Mon Niveau"}
            grades={data.results
              .filter((r) => !r.absent && r.score !== null)
              .map((r) => ({ subject: r.subject, score20: (r.score! / r.maxScore) * 20 }))}
          />
          <section className="card stack">
            <h2 className="h2">{t("attendance")}</h2>
            {data.attendance.length === 0 ? <p className="muted">{t("no_data")}</p> : null}
            <ul className="list-reset parent-list">
              {data.attendance.map((r, index) => (
                <li key={`${r.date}-${r.slot}-${index}`} className="parent-list__item">
                  <span>{formatCivilDate(r.date)}</span>
                  <span>{t(`st_${r.status}`)}</span>
                </li>
              ))}
            </ul>
          </section>
          <AiOrientationAssistant
            studentName={data.me.displayName}
            initialClass={data.me.classroom?.name ?? "Mon Niveau"}
            grades={data.results
              .filter((r) => !r.absent && r.score !== null)
              .map((r) => ({ subject: r.subject, score20: (r.score! / r.maxScore) * 20 }))}
          />
          <section className="card stack">
            <h2 className="h2">{t("justification_status")}</h2>
            {data.justifications.length === 0 ? <p className="muted">{t("no_data")}</p> : null}
            <ul className="list-reset parent-list">
              {data.justifications.map((j) => (
                <li key={j.id} className="parent-list__item">
                  <span>{formatCivilDate(j.fromDate)}</span>
                  <span>{t(`j_${j.status}`)}</span>
                </li>
              ))}
            </ul>
          </section>
          <AiOrientationAssistant
            studentName={data.me.displayName}
            initialClass={data.me.classroom?.name ?? "Mon Niveau"}
            grades={data.results
              .filter((r) => !r.absent && r.score !== null)
              .map((r) => ({ subject: r.subject, score20: (r.score! / r.maxScore) * 20 }))}
          />
        </>
      ) : null}
    </main>
  );
}