"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { describeError, listInbox } from "@/lib/api";
import { dateShort, dateTime, LocaleSwitch, translateDynamic, useI18n } from "@/lib/i18n";
import { MESSAGE_KIND_LABEL } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { InboxMessage } from "@/lib/types";

type Filter = "all" | "events" | "pending";

/** Lot 5 : messages, annonces et événements reçus par le parent (t52u C7 : FR/AR). */
export default function FamilyMessagesPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "parent";
  const { locale, setLocale, t, dir } = useI18n();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Lot 10 (lint react-hooks/purity) : horodatage fige au montage, pas a chaque rendu.
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!allowed) return;
    listInbox()
      .then(setMessages)
      .catch((cause) => setError(describeError(cause)))
      .finally(() => setLoading(false));
  }, [allowed]);

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">{t("parents_only")}</div>
      </main>
    );
  }

  const shown = messages.filter((message) =>
    filter === "events"
      ? message.kind === "event" && message.eventAt && new Date(message.eventAt).getTime() >= now - 86_400_000
      : filter === "pending"
        ? !message.readAt || (message.requiresAck && !message.acknowledgedAt)
        : true,
  );
  if (filter === "events") shown.sort((a, b) => (a.eventAt ?? "").localeCompare(b.eventAt ?? ""));
  const pending = messages.filter((message) => !message.readAt || (message.requiresAck && !message.acknowledgedAt)).length;

  return (
    <main className="page stack parent-space" dir={dir} lang={locale}>
      <div className="page-head">
        <div>
          <h1 className="h1">{t("messages_title")}</h1>
          <p className="subtitle">{t("messages_subtitle")}</p>
        </div>
        {/* <LocaleSwitch locale={locale} setLocale={setLocale} label={t("lang_switch")} /> */}
      </div>
      <div className="seg seg--full" role="tablist" aria-label={t("filter")}>
        <button type="button" className="seg__btn" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
          {t("all")}
        </button>
        <button type="button" className="seg__btn" aria-pressed={filter === "pending"} onClick={() => setFilter("pending")}>
          {t("to_read")}{pending > 0 ? ` (${pending})` : ""}
        </button>
        <button type="button" className="seg__btn" aria-pressed={filter === "events"} onClick={() => setFilter("events")}>
          {t("events")}
        </button>
      </div>
      {error ? <div className="alert alert--error">{error}</div> : null}
      {loading ? <p className="muted">{t("loading")}</p> : null}
      {!loading && shown.length === 0 ? <p className="muted">{t("nothing_to_show")}</p> : null}
      <ul className="list-reset parent-list card">
        {shown.map((message) => (
          <li key={message.id} className={`parent-list__item${message.readAt ? "" : " parent-list__item--unread"}`}>
            <Link href={`/family/messages/${message.id}`} style={{ flex: 1, color: "inherit", textDecoration: "none" }}>
              <div>
                {message.important ? <span className="badge badge--absent">{t("important")}</span> : null} <strong>{message.title}</strong>
              </div>
              <div className="muted">
                {translateDynamic(locale, `msg_${message.kind}`, MESSAGE_KIND_LABEL[message.kind] ?? message.kind)}
                {message.classroom ? ` · ${message.classroom.name}` : ""}
                {message.student ? ` · ${message.student.displayName}` : ""} · {dateShort(locale, message.createdAt)}
              </div>
              {message.eventAt ? (
                <div>
                  {dateTime(locale, message.eventAt)}
                  {message.eventLocation ? ` · ${message.eventLocation}` : ""}
                </div>
              ) : (
                <div className="muted">{message.preview}</div>
              )}
            </Link>
            {message.requiresAck && !message.acknowledgedAt ? <span className="badge badge--pending">{t("ack_requested")}</span> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
