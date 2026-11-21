"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { describeError, downloadAgendaAttachment, getAgendaItem } from "@/lib/api";
import { civilDate, LocaleSwitch, translateDynamic, useI18n } from "@/lib/i18n";
import { AGENDA_KIND_LABEL } from "@/lib/labels";
import type { AgendaDetail } from "@/lib/types";

/** Lot 6 : détail d'un devoir ou d'une date pour le parent (t52u C7 : FR/AR). */
export default function FamilyAgendaItemPage() {
  const { id } = useParams<{ id: string }>();
  const { locale, setLocale, t, dir } = useI18n();
  const [item, setItem] = useState<AgendaDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAgendaItem(id, true)
      .then(setItem)
      .catch((cause) => setError(describeError(cause)));
  }, [id]);

  return (
    <main className="page stack parent-space" dir={dir} lang={locale}>
      <div className="page-head">
        <Link href="/family/agenda">{t("back_agenda")}</Link>
        {/* <LocaleSwitch locale={locale} setLocale={setLocale} label={t("lang_switch")} /> */}
      </div>
      {error ? <div className="alert alert--error">{error}</div> : null}
      {item ? (
        <section className="card stack">
          <div className="muted">
            {translateDynamic(locale, `kind_${item.kind}`, AGENDA_KIND_LABEL[item.kind] ?? item.kind)} · {item.classroom?.name ?? t("whole_school")}
          </div>
          <h1 className="h1">{item.title}</h1>
          <p>
            <strong>{item.kind === "homework" ? t("due_on") : ""}{civilDate(locale, item.date)}</strong>
          </p>
          {item.description ? <p style={{ whiteSpace: "pre-wrap" }}>{item.description}</p> : null}
          {item.attachments.map((attachment) => (
            <button
              key={attachment.id}
              className="btn btn--block"
              type="button"
              onClick={() =>
                void downloadAgendaAttachment(id, attachment.id, attachment.name, true).catch((cause) =>
                  setError(describeError(cause)),
                )
              }
            >
              {attachment.name}
            </button>
          ))}
        </section>
      ) : error ? null : (
        <p className="muted">{t("loading")}</p>
      )}
    </main>
  );
}
