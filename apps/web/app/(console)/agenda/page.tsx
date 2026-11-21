"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createAgendaItem, describeError, listAgenda, listClassrooms } from "@/lib/api";
import { AgendaTimeline } from "@/lib/agenda-view";
import { addDays, AGENDA_KIND_LABEL, todayInMorocco } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { AgendaKind, AgendaRange, ClassroomRow } from "@/lib/types";

type Notice = { tone: "ok" | "error"; text: string } | null;
const MAX_FILE_BYTES = 5_000_000;

/** Lot 6 : agenda de classe, devoirs et dates importantes (direction, enseignants). */
export default function AgendaPage() {
  const profile = useActiveProfile();
  const isDirection = profile?.role === "direction";
  const allowed = isDirection || profile?.role === "teacher";

  const [from, setFrom] = useState(todayInMorocco());
  const [filterClass, setFilterClass] = useState("");
  const [data, setData] = useState<AgendaRange | null>(null);
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [kind, setKind] = useState<AgendaKind>("homework");
  const [classroomId, setClassroomId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(addDays(todayInMorocco(), 1));
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await listAgenda({ from, to: addDays(from, 30), classroomId: filterClass || undefined }));
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    }
  }, [from, filterClass]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  useEffect(() => {
    if (!allowed) return;
    listClassrooms()
      .then((result) => setClassrooms(result.classrooms))
      .catch(() => setClassrooms([]));
  }, [allowed]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.some((file) => file.size > MAX_FILE_BYTES)) {
      setNotice({ tone: "error", text: "Chaque pièce jointe est limitée à 5 Mo." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      // Bloc 3b : fichiers envoyes tels quels en multipart.
      const attachments = files;
      const result = await createAgendaItem({
        kind,
        classroomId: kind === "important_date" && !classroomId ? undefined : classroomId,
        title: title.trim(),
        description: description.trim() || undefined,
        date,
        attachments,
      });
      setNotice({
        tone: "ok",
        text: `${AGENDA_KIND_LABEL[kind]} publié${result.notified ? `, ${result.notified} parent(s) notifié(s) dans l'application` : ""}.`,
      });
      setTitle("");
      setDescription("");
      setFiles([]);
      await load();
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

  const kinds: AgendaKind[] = isDirection ? ["homework", "test", "class_event", "important_date"] : ["homework", "test", "class_event"];

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Agenda et devoirs</h1>
          <p className="subtitle">Devoirs, contrôles, événements de classe et dates importantes. Les événements d&apos;école viennent des Messages.</p>
        </div>
      </div>

      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}

      <form className="card stack" onSubmit={(event) => void onSubmit(event)}>
        <div className="seg" role="group" aria-label="Type">
          {kinds.map((entry) => (
            <button key={entry} type="button" className="seg__btn" aria-pressed={kind === entry} onClick={() => setKind(entry)}>
              {AGENDA_KIND_LABEL[entry]}
            </button>
          ))}
        </div>
        <div className="row">
          <div className="field">
            <label className="label" htmlFor="a-class">
              Classe
            </label>
            <select
              id="a-class"
              className="select"
              value={classroomId}
              onChange={(e) => setClassroomId(e.target.value)}
              required={kind !== "important_date"}
            >
              <option value="">{kind === "important_date" ? "Toute l'école" : "Choisir…"}</option>
              {classrooms.map((classroom) => (
                <option key={classroom.id} value={classroom.id}>
                  {classroom.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="a-date">
              {kind === "homework" ? "À rendre le" : "Date"}
            </label>
            <input id="a-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="a-title">
            Titre
          </label>
          <input id="a-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={160} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="a-desc">
            Description
          </label>
          <textarea id="a-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
        </div>
        <div className="field">
          <label className="label" htmlFor="a-files">
            Pièces jointes (PDF, JPEG, PNG ; 3 au maximum, 5 Mo chacune)
          </label>
          <input
            id="a-files"
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 3))}
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          Publier
        </button>
      </form>

      <div className="card filters">
        <div className="field">
          <label className="label" htmlFor="f-from">
            À partir du
          </label>
          <input id="f-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="f-class">
            Classe
          </label>
          <select id="f-class" className="select" value={filterClass} onChange={(e) => setFilterClass(e.target.value)}>
            <option value="">{isDirection ? "Toutes" : "Mes classes"}</option>
            {classrooms.map((classroom) => (
              <option key={classroom.id} value={classroom.id}>
                {classroom.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {data ? <AgendaTimeline data={data} hrefBase="/agenda" /> : <p className="muted">Chargement…</p>}
    </main>
  );
}
