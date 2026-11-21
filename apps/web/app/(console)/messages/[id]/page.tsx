"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { describeError, getStaffMessage, replyAsStaff } from "@/lib/api";
import { formatDate, formatDateTime, MESSAGE_KIND_LABEL, roleLabel } from "@/lib/labels";
import type { StaffMessageDetail } from "@/lib/types";

/** Lot 5 : suivi d'un message (lectures, accusés) et échange individuel. */
export default function StaffMessagePage() {
  const { id } = useParams<{ id: string }>();
  const [message, setMessage] = useState<StaffMessageDetail | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMessage(await getStaffMessage(id));
    } catch (cause) {
      setError(describeError(cause));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await replyAsStaff(id, reply.trim());
      setReply("");
      await load();
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  const read = message?.tracking.filter((entry) => entry.readAt).length ?? 0;

  return (
    <main className="page stack">
      <Link href="/messages">← Messages</Link>
      {error ? <div className="alert alert--error">{error}</div> : null}
      {!message ? (
        error ? null : <p className="muted">Chargement…</p>
      ) : (
        <>
          <section className="card stack">
            <div className="muted">
              {MESSAGE_KIND_LABEL[message.kind]} · {formatDate(message.createdAt)} ·{" "}
              {message.classroom?.name ?? message.student?.displayName ?? "Toute l'école"}
            </div>
            <h1 className="h1">{message.title}</h1>
            {message.important ? <span className="badge badge--absent">Important</span> : null}
            {message.eventAt ? (
              <p>
                <strong>{formatDateTime(message.eventAt)}</strong>
                {message.eventLocation ? ` · ${message.eventLocation}` : ""}
              </p>
            ) : null}
            <p style={{ whiteSpace: "pre-wrap" }}>{message.body}</p>
          </section>

          <section className="card stack">
            <h2 className="h2">
              Lectures : {read} / {message.tracking.length}
              {message.requiresAck
                ? ` · Accusés : ${message.tracking.filter((entry) => entry.acknowledgedAt).length} / ${message.tracking.length}`
                : ""}
            </h2>
            {message.tracking.length === 0 ? <p className="muted">Aucun parent avec un compte actif pour ce public.</p> : null}
            <ul className="list-reset parent-list">
              {message.tracking.map((entry, index) => (
                <li key={`${entry.name}-${index}`} className="parent-list__item">
                  <span>{entry.name}</span>
                  <span>
                    {entry.readAt ? <span className="badge badge--active">Lu le {formatDate(entry.readAt)}</span> : <span className="badge badge--muted">Non lu</span>}{" "}
                    {message.requiresAck ? (
                      entry.acknowledgedAt ? <span className="badge badge--active">Accusé</span> : <span className="badge badge--pending">Sans accusé</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {message.kind === "direct" ? (
            <section className="card stack">
              <h2 className="h2">Échange</h2>
              {message.replies.length === 0 ? <p className="muted">Pas encore de réponse.</p> : null}
              <ol className="timeline">
                {message.replies.map((entry) => (
                  <li key={entry.id} className="timeline__item">
                    <strong>{roleLabel(entry.authorRole)}</strong> · {formatDate(entry.createdAt)}
                    <div style={{ whiteSpace: "pre-wrap" }}>{entry.body}</div>
                  </li>
                ))}
              </ol>
              <form className="stack" onSubmit={(event) => void onReply(event)}>
                <textarea className="textarea" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={2000} required aria-label="Réponse" />
                <button className="btn btn--teal" type="submit" disabled={busy}>
                  Répondre
                </button>
              </form>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
