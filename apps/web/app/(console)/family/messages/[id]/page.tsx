"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { acknowledgeMessage, describeError, openInboxMessage, replyAsParent } from "@/lib/api";
import { dateShort, dateTime, LocaleSwitch, roleText, translateDynamic, useI18n } from "@/lib/i18n";
import { MESSAGE_KIND_LABEL } from "@/lib/labels";
import type { InboxMessageDetail } from "@/lib/types";

/** Lot 5 : lecture d'un message (accusé de lecture automatique), accusé de réception, réponse. */
export default function FamilyMessagePage() {
  const { id } = useParams<{ id: string }>();
  const { locale, setLocale, t, dir } = useI18n();
  const [message, setMessage] = useState<InboxMessageDetail | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMessage(await openInboxMessage(id));
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  function onReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await replyAsParent(id, reply.trim());
      setReply("");
    });
  }

  return (
    <main className="page stack parent-space" dir={dir} lang={locale}>
      <div className="page-head">
        <Link href="/family/messages">{t("back_messages")}</Link>
        {/* <LocaleSwitch locale={locale} setLocale={setLocale} label={t("lang_switch")} /> */}
      </div>
      {error ? <div className="alert alert--error">{error}</div> : null}
      {message ? (
        <>
          <section className="card stack">
            <div className="muted">
              {translateDynamic(locale, `msg_${message.kind}`, MESSAGE_KIND_LABEL[message.kind] ?? message.kind)}
              {message.classroom ? ` · ${message.classroom.name}` : ""}
              {message.student ? ` · ${message.student.displayName}` : ""} · {dateShort(locale, message.createdAt)}
            </div>
            <h1 className="h1">{message.title}</h1>
            {message.important ? <span className="badge badge--absent">{t("important")}</span> : null}
            {message.eventAt ? (
              <p>
                <strong>{dateTime(locale, message.eventAt)}</strong>
                {message.eventLocation ? ` · ${message.eventLocation}` : ""}
              </p>
            ) : null}
            <p style={{ whiteSpace: "pre-wrap" }}>{message.body}</p>
            {message.requiresAck ? (
              message.acknowledgedAt ? (
                <div className="alert alert--ok">{t("ack_sent")} {dateShort(locale, message.acknowledgedAt)}.</div>
              ) : (
                <button className="btn btn--primary btn--block" type="button" disabled={busy} onClick={() => void run(() => acknowledgeMessage(id))}>
                  {t("ack_button")}
                </button>
              )
            ) : null}
          </section>

          {message.kind === "direct" ? (
            <section className="card stack">
              <h2 className="h2">{t("exchange")}</h2>
              {message.replies.length === 0 ? <p className="muted">{t("no_reply")}</p> : null}
              <ol className="timeline">
                {message.replies.map((entry) => (
                  <li key={entry.id} className="timeline__item">
                    <strong>{entry.mine ? t("you") : roleText(locale, entry.authorRole)}</strong> · {dateShort(locale, entry.createdAt)}
                    <div style={{ whiteSpace: "pre-wrap" }}>{entry.body}</div>
                  </li>
                ))}
              </ol>
              <form className="stack" onSubmit={onReply}>
                <textarea className="textarea" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} required aria-label={t("your_reply")} />
                <button className="btn btn--teal btn--block" type="submit" disabled={busy}>
                  {t("reply")}
                </button>
              </form>
            </section>
          ) : null}
        </>
      ) : error ? null : (
        <p className="muted">{t("loading")}</p>
      )}
    </main>
  );
}
