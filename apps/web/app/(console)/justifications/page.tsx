"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { describeError, downloadPrivateFile, listSchoolJustifications, reviewJustification } from "@/lib/api";
import { formatCivilDate, formatDate } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { Justification, JustificationStatus } from "@/lib/types";

type Notice = { tone: "ok" | "error"; text: string } | null;

const FILTERS: { value: JustificationStatus | ""; label: string }[] = [
  { value: "pending", label: "En attente" },
  { value: "incomplete", label: "À compléter" },
  { value: "accepted", label: "Acceptés" },
  { value: "rejected", label: "Refusés" },
  { value: "", label: "Tous" },
];

/** Lot 4 : examen des justificatifs d'absence (direction, MFA). */
export default function JustificationsPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "direction";

  const [status, setStatus] = useState<JustificationStatus | "">("pending");
  const [items, setItems] = useState<Justification[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (filter: JustificationStatus | "") => {
    setLoading(true);
    try {
      setItems(await listSchoolJustifications(filter || undefined));
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load(status);
  }, [allowed, load, status]);

  async function decide(entry: Justification, decision: "accepted" | "rejected" | "incomplete") {
    setBusyId(entry.id);
    setNotice(null);
    try {
      await reviewJustification(entry.id, decision, notes[entry.id]?.trim() || undefined);
      setNotice({
        tone: "ok",
        text:
          decision === "accepted"
            ? "Justificatif accepté, la famille est notifiée."
            : decision === "incomplete"
              ? "Complément demandé : la famille est notifiée et une demande « À faire » lui est ouverte."
              : "Justificatif refusé, la famille est notifiée.",
      });
      await load(status);
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusyId(null);
    }
  }

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">Cette page est réservée à la direction.</div>
      </main>
    );
  }

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Justificatifs</h1>
          <p className="subtitle">Pièces envoyées par les familles. Chaque décision est notifiée et tracée.</p>
        </div>
      </div>

      <div className="seg" role="group" aria-label="Filtrer">
        {FILTERS.map((filter) => (
          <button key={filter.label} type="button" className="seg__btn" aria-pressed={status === filter.value} onClick={() => setStatus(filter.value)}>
            {filter.label}
          </button>
        ))}
      </div>

      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}
      {loading ? <p className="muted">Chargement…</p> : null}
      {!loading && items.length === 0 ? <p className="muted">Aucun justificatif.</p> : null}

      {items.map((entry) => (
        <section key={entry.id} className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <Link href={`/students/${entry.student.id}`}>
                <strong>{entry.student.displayName}</strong>
              </Link>{" "}
              <span className="mono muted">{entry.student.studentCode}</span>
              <div>
                {formatCivilDate(entry.fromDate)}
                {entry.toDate !== entry.fromDate ? ` → ${formatCivilDate(entry.toDate)}` : ""}
              </div>
            </div>
            <span className="muted">Reçu le {formatDate(entry.createdAt)}</span>
          </div>
          <p>{entry.reason}</p>
          {entry.file ? (
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() =>
                void downloadPrivateFile(`/justifications/${entry.id}/file`, entry.file?.name ?? "justificatif").catch((cause) =>
                  setNotice({ tone: "error", text: describeError(cause) }),
                )
              }
            >
              Télécharger la pièce ({Math.max(1, Math.round(entry.file.sizeBytes / 1024))} Ko)
            </button>
          ) : (
            <p className="muted">Sans pièce jointe.</p>
          )}
          {entry.status === "pending" ? (
            <div className="stack">
              <input
                className="input"
                placeholder="Note pour la famille (obligatoire pour refuser ou demander un complément)"
                value={notes[entry.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [entry.id]: e.target.value })}
                maxLength={500}
              />
              <div className="row">
                <button className="btn btn--teal" type="button" disabled={busyId === entry.id} onClick={() => void decide(entry, "accepted")}>
                  Accepter
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busyId === entry.id || !(notes[entry.id] ?? "").trim()}
                  onClick={() => void decide(entry, "rejected")}
                >
                  Refuser
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={busyId === entry.id || !(notes[entry.id] ?? "").trim()}
                  onClick={() => void decide(entry, "incomplete")}
                >
                  À compléter
                </button>
              </div>
            </div>
          ) : (
            <div>
              <span
                className={`badge ${entry.status === "accepted" ? "badge--active" : entry.status === "incomplete" ? "badge--pending" : "badge--absent"}`}
              >
                {entry.status === "accepted" ? "Accepté" : entry.status === "incomplete" ? "À compléter (en attente de la famille)" : "Refusé"}
              </span>{" "}
              {entry.reviewNote ? <span className="muted">{entry.reviewNote}</span> : null}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
