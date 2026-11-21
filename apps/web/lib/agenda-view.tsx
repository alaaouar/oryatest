"use client";

import Link from "next/link";
import { civilDate, dateTime, translate, translateDynamic, type Locale } from "./i18n";
import { AGENDA_KIND_LABEL } from "./labels";
import type { AgendaRange } from "./types";

/**
 * Liste chronologique : entrées d'agenda + événements d'école (lot 5) regroupés par jour.
 * t52u C7 : `locale` facultatif (défaut "fr", rendu inchangé pour la console école) ; l'arabe est à relire par un arabophone.
 */
export function AgendaTimeline({ data, hrefBase, locale = "fr" }: { data: AgendaRange; hrefBase: string; locale?: Locale }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  type Row =
    | { type: "item"; day: string; item: AgendaRange["items"][number] }
    | { type: "event"; day: string; event: AgendaRange["events"][number] };
  const rows: Row[] = [
    ...data.items.map((item) => ({ type: "item" as const, day: item.date, item })),
    ...data.events.map((event) => ({ type: "event" as const, day: event.at.slice(0, 10), event })),
  ].sort((a, b) => a.day.localeCompare(b.day));

  if (rows.length === 0) return <p className="muted">{t("nothing_planned")}</p>;

  const days = [...new Set(rows.map((row) => row.day))];
  return (
    <div className="stack">
      {days.map((day) => (
        <section key={day} className="card stack">
          <h2 className="h2">{civilDate(locale, day)}</h2>
          <ul className="list-reset parent-list">
            {rows
              .filter((row) => row.day === day)
              .map((row) =>
                row.type === "item" ? (
                  <li key={row.item.id} className="parent-list__item">
                    <Link href={`${hrefBase}/${row.item.id}`} style={{ flex: 1, color: "inherit" }}>
                      <div>
                        <span className={`badge ${row.item.kind === "test" ? "badge--absent" : row.item.kind === "homework" ? "badge--pending" : "badge--active"}`}>
                          {translateDynamic(locale, `kind_${row.item.kind}`, AGENDA_KIND_LABEL[row.item.kind] ?? row.item.kind)}
                        </span>{" "}
                        <strong style={row.item.cancelled ? { textDecoration: "line-through" } : undefined}>{row.item.title}</strong>
                      </div>
                      <div className="muted">
                        {row.item.classroom?.name ?? t("whole_school")}
                        {row.item.attachments.length > 0 ? ` · ${row.item.attachments.length} ${t("n_attachments")}` : ""}
                        {row.item.cancelled ? ` · ${t("cancelled")}` : ""}
                      </div>
                    </Link>
                  </li>
                ) : (
                  <li key={row.event.id} className="parent-list__item">
                    <div style={{ flex: 1 }}>
                      <div>
                        <span className="badge badge--active">{t("event")}</span> <strong>{row.event.title}</strong>
                      </div>
                      <div className="muted">
                        {dateTime(locale, row.event.at)}
                        {row.event.location ? ` · ${row.event.location}` : ""}
                        {row.event.classroom ? ` · ${row.event.classroom.name}` : ""}
                      </div>
                    </div>
                  </li>
                ),
              )}
          </ul>
        </section>
      ))}
    </div>
  );
}
