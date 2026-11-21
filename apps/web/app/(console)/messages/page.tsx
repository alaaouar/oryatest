"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { describeError, listChannels, listClassrooms, listSentMessages, listStudents, sendMessage } from "@/lib/api";
import { formatDate, MESSAGE_KIND_LABEL } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { ChannelInfo, ClassroomRow, DeliveryReport, MessageAudience, MessageKind, SentMessage, StudentListRow } from "@/lib/types";

type Notice = { tone: "ok" | "error" | "warn"; text: string } | null;

const AUDIENCES: Record<MessageKind, MessageAudience[]> = {
  announcement: ["school", "level", "classroom", "selection"],
  event: ["school", "level", "classroom", "selection"],
  class_message: ["classroom"],
  direct: ["student"],
};
const AUDIENCE_LABEL: Record<MessageAudience, string> = {
  school: "Toute l'école",
  level: "Un niveau",
  classroom: "Une classe",
  selection: "Une sélection d'élèves",
  student: "Une famille",
};
/** t92 M5 : publics réservés à la direction (un enseignant écrit à ses classes ou à des élèves de ses classes). */
const DIRECTION_ONLY: MessageAudience[] = ["school", "level"];

/** Lot 5 : envoi et suivi des messages (direction et enseignants, in-app). */
export default function MessagesPage() {
  const profile = useActiveProfile();
  const isDirection = profile?.role === "direction";
  const allowed = isDirection || profile?.role === "teacher";

  const [messages, setMessages] = useState<SentMessage[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [students, setStudents] = useState<StudentListRow[]>([]);
  const [kind, setKind] = useState<MessageKind>(isDirection ? "announcement" : "class_message");
  const [audience, setAudience] = useState<MessageAudience>(isDirection ? "school" : "classroom");
  const [classroomId, setClassroomId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [level, setLevel] = useState("");
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [requiresAck, setRequiresAck] = useState(false);
  const [eventAt, setEventAt] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [extra, setExtra] = useState<"email"[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMessages(await listSentMessages());
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load();
    listChannels().then(setChannels).catch(() => setChannels([]));
    listClassrooms().then((data) => setClassrooms(data.classrooms)).catch(() => setClassrooms([]));
    listStudents().then(setStudents).catch(() => setStudents([]));
  }, [allowed, load]);

  function chooseKind(next: MessageKind) {
    setKind(next);
    const options = AUDIENCES[next].filter((entry) => isDirection || !DIRECTION_ONLY.includes(entry));
    if (!options.includes(audience)) setAudience(options[0]);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await sendMessage({
        kind,
        audience,
        classroomId: audience === "classroom" ? classroomId : undefined,
        studentId: audience === "student" ? studentId : undefined,
        level: audience === "level" ? level : undefined,
        studentIds: audience === "selection" ? studentIds : undefined,
        title: title.trim(),
        body: body.trim(),
        important,
        requiresAck,
        eventAt: kind === "event" && eventAt ? new Date(eventAt).toISOString() : undefined,
        eventLocation: kind === "event" ? eventLocation.trim() || undefined : undefined,
        channels: extra,
      });
      setNotice({ tone: result.recipients === 0 ? "warn" : "ok", text: describeDelivery(result.recipients, result.delivery) });
      setTitle("");
      setBody("");
      setImportant(false);
      setRequiresAck(false);
      setStudentIds([]);
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

  const kinds: MessageKind[] = isDirection ? ["announcement", "event", "class_message", "direct"] : ["class_message", "direct", "event"];
  const audiences = AUDIENCES[kind].filter((entry) => isDirection || !DIRECTION_ONLY.includes(entry));
  const levels = [...new Set(classrooms.map((c) => c.level?.trim()).filter((l): l is string => !!l))].sort((a, b) => a.localeCompare(b, "fr"));
  const external = channels.filter((channel) => channel.channel !== "in_app");

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Messages</h1>
          <p className="subtitle">Annonces, événements, messages de classe et échanges individuels, avec suivi de lecture.</p>
        </div>
      </div>

      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}

      <form className="card stack" onSubmit={(event) => void onSubmit(event)}>
        <div className="seg" role="group" aria-label="Type">
          {kinds.map((entry) => (
            <button key={entry} type="button" className="seg__btn" aria-pressed={kind === entry} onClick={() => chooseKind(entry)}>
              {MESSAGE_KIND_LABEL[entry]}
            </button>
          ))}
        </div>
        <div className="row">
          <div className="field">
            <label className="label" htmlFor="m-aud">
              Destinataires
            </label>
            <select id="m-aud" className="select" value={audience} onChange={(e) => setAudience(e.target.value as MessageAudience)}>
              {audiences.map((entry) => (
                <option key={entry} value={entry}>
                  {AUDIENCE_LABEL[entry]}
                </option>
              ))}
            </select>
          </div>
          {audience === "classroom" ? (
            <div className="field">
              <label className="label" htmlFor="m-class">
                Classe
              </label>
              <select id="m-class" className="select" value={classroomId} onChange={(e) => setClassroomId(e.target.value)} required>
                <option value="">Choisir…</option>
                {classrooms.map((classroom) => (
                  <option key={classroom.id} value={classroom.id}>
                    {classroom.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {audience === "level" ? (
            <div className="field">
              <label className="label" htmlFor="m-level">
                Niveau
              </label>
              <select id="m-level" className="select" value={level} onChange={(e) => setLevel(e.target.value)} required>
                <option value="">Choisir…</option>
                {levels.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
              {levels.length === 0 ? <p className="muted">Aucun niveau renseigné sur les classes.</p> : null}
            </div>
          ) : null}
          {audience === "selection" ? (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Élèves sélectionnés ({studentIds.length})</legend>
              <div className="stack" style={{ maxHeight: 220, overflowY: "auto", gap: 4 }}>
                {students.map((student) => (
                  <label key={student.id} className="row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={studentIds.includes(student.id)}
                      onChange={(e) =>
                        setStudentIds((current) =>
                          e.target.checked ? [...current, student.id] : current.filter((id) => id !== student.id),
                        )
                      }
                    />
                    <span>
                      {student.displayName}
                      {student.classroom ? ` · ${student.classroom.name}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {audience === "student" ? (
            <div className="field">
              <label className="label" htmlFor="m-student">
                Élève (sa famille)
              </label>
              <select id="m-student" className="select" value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
                <option value="">Choisir…</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.displayName}
                    {student.classroom ? ` · ${student.classroom.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div className="field">
          <label className="label" htmlFor="m-title">
            Titre
          </label>
          <input id="m-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={160} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="m-body">
            Message
          </label>
          <textarea id="m-body" className="textarea" value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} required />
        </div>
        {kind === "event" ? (
          <div className="row">
            <div className="field">
              <label className="label" htmlFor="m-at">
                Date et heure
              </label>
              <input id="m-at" type="datetime-local" className="input" value={eventAt} onChange={(e) => setEventAt(e.target.value)} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="m-loc">
                Lieu
              </label>
              <input id="m-loc" className="input" value={eventLocation} onChange={(e) => setEventLocation(e.target.value)} />
            </div>
          </div>
        ) : null}
        <div className="row">
          <label className="row">
            <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Important
          </label>
          <label className="row">
            <input type="checkbox" checked={requiresAck} onChange={(e) => setRequiresAck(e.target.checked)} /> Demander un accusé de réception
          </label>
        </div>
        {external.length > 0 ? (
          <fieldset className="row" style={{ border: "none", padding: 0 }}>
            <legend className="label">Canaux en plus de l&apos;application</legend>
            {external.map((channel) => (
              <label key={channel.channel} className="row muted">
                <input
                  type="checkbox"
                  checked={extra.includes(channel.channel as "email")}
                  onChange={(e) =>
                    setExtra(
                      e.target.checked
                        ? [...extra, channel.channel as "email"]
                        : extra.filter((entry) => entry !== channel.channel),
                    )
                  }
                />
                E-mail ({channel.label})
              </label>
            ))}
          </fieldset>
        ) : null}
        <button className="btn btn--primary" type="submit" disabled={busy}>
          Envoyer
        </button>
      </form>

      <section className="card stack">
        <h2 className="h2">Envoyés</h2>
        {messages.length === 0 ? <p className="muted">Aucun message envoyé.</p> : null}
        <table className="table table--stack">
          <thead>
            <tr>
              <th>Message</th>
              <th>Destinataires</th>
              <th>Lus</th>
              <th>Accusés</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id}>
                <td data-label="Message">
                  <Link href={`/messages/${message.id}`}>{message.title}</Link>
                  <div className="muted">
                    {MESSAGE_KIND_LABEL[message.kind]} · {formatDate(message.createdAt)}
                    {message.important ? " · Important" : ""}
                  </div>
                </td>
                <td data-label="Destinataires">
                  {message.audience === "level"
                    ? `Niveau ${message.level ?? ""}`
                    : message.audience === "selection"
                      ? `Sélection de ${message.studentIds?.length ?? 0} élève(s)`
                      : (message.classroom?.name ?? message.student?.displayName ?? "Toute l'école")}{" "}
                  ({message.recipients})
                </td>
                <td data-label="Lus">
                  {message.readCount} / {message.recipients}
                </td>
                <td data-label="Accusés">{message.requiresAck ? `${message.ackCount} / ${message.recipients}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function describeDelivery(recipients: number, delivery: DeliveryReport[]): string {
  if (recipients === 0) return "Message enregistré, mais aucun parent n'a encore de compte actif pour ce public.";
  const parts = delivery.map((entry) =>
    entry.status === "sent"
      ? `application : ${entry.delivered} parent(s)`
      : `e-mail : non configuré, rien n'a été envoyé`,
  );
  return `Message envoyé (${parts.join(" ; ")}).`;
}
