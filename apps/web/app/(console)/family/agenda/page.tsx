"use client";

import { useEffect, useState } from "react";
import { describeError, listFamilyAgenda } from "@/lib/api";
import { AgendaTimeline } from "@/lib/agenda-view";
import { LocaleSwitch, useI18n } from "@/lib/i18n";
import { addDays, todayInMorocco } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { AgendaRange } from "@/lib/types";

/** Lot 6 : agenda des classes de mes enfants, dates d'école et événements (t52u C7 : FR/AR). */
export default function FamilyAgendaPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "parent";
  const { locale, setLocale, t, dir } = useI18n();
  const [weekOffset, setWeekOffset] = useState(0);
  const [data, setData] = useState<AgendaRange | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = addDays(todayInMorocco(), weekOffset * 14);

  useEffect(() => {
    if (!allowed) return;
    setData(null);
    listFamilyAgenda({ from, to: addDays(from, 13) })
      .then(setData)
      .catch((cause) => setError(describeError(cause)));
  }, [allowed, from]);

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">{t("parents_only")}</div>
      </main>
    );
  }

  return (
    <main className="page stack parent-space" dir={dir} lang={locale}>
      <div className="page-head">
        <div>
          <h1 className="h1">{t("agenda")}</h1>
          <p className="subtitle">{t("agenda_subtitle")}</p>
        </div>
        {/* <LocaleSwitch locale={locale} setLocale={setLocale} label={t("lang_switch")} /> */}
      </div>
      <div className="seg seg--full" role="group" aria-label={t("period")}>
        <button type="button" className="seg__btn" onClick={() => setWeekOffset(weekOffset - 1)}>
          {t("previous")}
        </button>
        <button type="button" className="seg__btn" aria-pressed={weekOffset === 0} onClick={() => setWeekOffset(0)}>
          {t("today")}
        </button>
        <button type="button" className="seg__btn" onClick={() => setWeekOffset(weekOffset + 1)}>
          {t("next")}
        </button>
      </div>
      {error ? <div className="alert alert--error">{error}</div> : null}
      {data ? <AgendaTimeline data={data} hrefBase="/family/agenda" locale={locale} /> : <p className="muted">{t("loading")}</p>}
    </main>
  );
}
