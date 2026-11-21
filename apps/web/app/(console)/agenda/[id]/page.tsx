"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  addAgendaAttachment,
  cancelAgendaItem,
  describeError,
  downloadAgendaAttachment,
  getAgendaItem,
  updateAgendaItem,
} from "@/lib/api";
import { AGENDA_KIND_LABEL, formatCivilDate, formatDate, historyActionLabel, roleLabel } from "@/lib/labels";
import type { AgendaDetail } from "@/lib/types";

type Notice = { tone: "ok" | "error"; text: string } | null;

/** Lot 6 : détail d'une entrée d'agenda, modification, pièces jointes, historique. */
export default function AgendaItemPage() {
  const { id } = useParams<{ id: string }>();
  const [item, setItem] = useState<AgendaDetail | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getAgendaItem(id);
      setItem(data);
      setTitle(data.title);
      setDescription(data.description ?? "");
      setDate(data.date);
    } catch (cause) {
      setLoadError(describeError(cause));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "ok", text: success });
      await load();
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(() => updateAgendaItem(id, { title: title.trim(), description: description.trim(), date }), "Modifications enregistrées.");
  }

  if (loadError) {
    return (
      <main className="page stack">
        <Link href="/agenda">← Agenda</Link>
        <div className="alert alert--error">{loadError}</div>
      </main>
    );
  }
  if (!item) {
    return (
      <main className="page">
        <p className="muted">Chargement…</p>
      </main>
    );
  }

  const editable = !!item.canEdit && !item.cancelled;

  return (
    <main className="page stack">
      <Link href="/agenda">← Agenda</Link>
      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}
      <section className="card stack">
        <div className="muted">
          {AGENDA_KIND_LABEL[item.kind]} · {item.classroom?.name ?? "Toute l'école"} · {formatCivilDate(item.date)}
          {item.cancelled ? " · Annulé" : ""}
        </div>
        {editable ? (
          <form className="stack" onSubmit={onSave}>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={160} required aria-label="Titre" />
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required aria-label="Date" />
            <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} aria-label="Description" />
            <div className="row">
              <button className="btn btn--primary" type="submit" disabled={busy}>
                Enregistrer
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => void run(() => cancelAgendaItem(id), "Entrée annulée.")}>
                Annuler l&apos;entrée
              </button>
            </div>
          </form>
        ) : (
          <>
            <h1 className="h1">{item.title}</h1>
            {item.description ? <p style={{ whiteSpace: "pre-wrap" }}>{item.description}</p> : null}
          </>
        )}
      </section>

      <section className="card stack">
        <h2 className="h2">Pièces jointes</h2>
        {item.attachments.length === 0 ? <p className="muted">Aucune.</p> : null}
        {item.attachments.map((attachment) => (
          <button
            key={attachment.id}
            className="btn btn--ghost"
            type="button"
            onClick={() =>
              void downloadAgendaAttachment(id, attachment.id, attachment.name).catch((cause) =>
                setNotice({ tone: "error", text: describeError(cause) }),
              )
            }
          >
            {attachment.name} ({Math.max(1, Math.round(attachment.sizeBytes / 1024))} Ko)
          </button>
        ))}
        {editable && item.attachments.length < 3 ? (
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            aria-label="Ajouter une pièce jointe"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void run(
                  async () => addAgendaAttachment(id, file),
                  "Pièce jointe ajoutée.",
                );
              }
            }}
          />
        ) : null}
      </section>

      <section className="card stack">
        <h2 className="h2">Historique</h2>
        <ol className="timeline">
          {(item.history ?? []).map((entry) => (
            <li key={entry.id} className="timeline__item">
              <strong>{historyActionLabel(entry.action)}</strong> · {formatDate(entry.createdAt)}
              {entry.actor ? ` · ${entry.actor.displayName} (${roleLabel(entry.actor.role)})` : ""}
              {entry.metadata?.changes
                ? Object.entries(entry.metadata.changes).map(([field, change]) => (
                    <div key={field} className="muted">
                      {field === "date" ? "Date" : field === "title" ? "Titre" : "Description"} : {change.from ?? "—"} → {change.to ?? "—"}
                    </div>
                  ))
                : null}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
