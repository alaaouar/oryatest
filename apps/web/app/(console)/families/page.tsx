"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  createGuardian,
  describeError,
  inviteGuardian,
  linkGuardian,
  listGuardians,
  listStudents,
  unlinkGuardian,
  updateGuardian,
} from "@/lib/api";
import { formatDate } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { GuardianInput, GuardianView, StudentListRow } from "@/lib/types";

type Notice = { tone: "ok" | "error"; text: string } | null;

const EMPTY: GuardianInput = { fullName: "", email: "", phone: "", phoneSecondary: "", address: "" };

function clean(input: GuardianInput): GuardianInput {
  return {
    fullName: input.fullName.trim(),
    email: input.email?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    phoneSecondary: input.phoneSecondary?.trim() || undefined,
    address: input.address?.trim() || undefined,
  };
}

/** Lot 3 : responsables légaux, contacts, liens enfants et invitations (direction). */
export default function FamiliesPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "direction";

  const [guardians, setGuardians] = useState<GuardianView[]>([]);
  const [students, setStudents] = useState<StudentListRow[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<GuardianInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<GuardianView | null>(null);
  const [childId, setChildId] = useState("");
  const [relationship, setRelationship] = useState("");
  const [invitation, setInvitation] = useState<{ guardian: string; token: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (needle = "") => {
    setLoading(true);
    try {
      const list = await listGuardians(needle || undefined);
      setGuardians(list);
      setSelected((current) => (current ? (list.find((entry) => entry.id === current.id) ?? null) : null));
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load();
    listStudents()
      .then(setStudents)
      .catch(() => setStudents([]));
  }, [allowed, load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "ok", text: success });
      await load(search.trim());
      return true;
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = clean(form);
    const ok = editingId
      ? await run(() => updateGuardian(editingId, payload), "Responsable mis à jour.")
      : await run(() => createGuardian(payload), "Responsable créé.");
    if (ok) {
      setForm(EMPTY);
      setEditingId(null);
    }
  }

  function startEdit(guardian: GuardianView) {
    setEditingId(guardian.id);
    setForm({
      fullName: guardian.fullName,
      email: guardian.email ?? "",
      phone: guardian.phone ?? "",
      phoneSecondary: guardian.phoneSecondary ?? "",
      address: guardian.address ?? "",
    });
  }

  async function onLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !childId) return;
    const ok = await run(
      () => linkGuardian(selected.id, { studentId: childId, relationship: relationship.trim() || undefined }),
      "Enfant rattaché.",
    );
    if (ok) {
      setChildId("");
      setRelationship("");
    }
  }

  async function onInvite(guardian: GuardianView) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await inviteGuardian(guardian.id);
      setInvitation({ guardian: guardian.fullName, token: result.token, expiresAt: result.expiresAt });
      await load(search.trim());
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">Cette page est réservée à la direction.</div>
      </main>
    );
  }

  const field = (key: keyof GuardianInput, label: string, type = "text", required = false) => (
    <div className="field">
      <label className="label" htmlFor={`g-${key}`}>
        {label}
      </label>
      <input
        id={`g-${key}`}
        className="input"
        type={type}
        required={required}
        value={form[key] ?? ""}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </div>
  );

  const linkedIds = new Set(selected?.students.map((entry) => entry.id) ?? []);

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Familles</h1>
          <p className="subtitle">Responsables légaux, coordonnées, enfants rattachés et accès parent.</p>
        </div>
        <Link className="btn" href="/imports">
          Importer des responsables
        </Link>
      </div>

      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}

      {invitation ? (
        <div className="alert alert--warn">
          Invitation pour {invitation.guardian}, valable jusqu&apos;au {formatDate(invitation.expiresAt)}. Ce lien
          n&apos;est affiché qu&apos;une fois : transmettez-le à la famille par votre canal habituel.
          <div className="mono" style={{ wordBreak: "break-all", marginTop: 8 }}>
            {typeof window !== "undefined" ? window.location.origin : ""}/activation?token={invitation.token}
          </div>
          <button className="btn btn--ghost" type="button" onClick={() => setInvitation(null)}>
            Masquer
          </button>
        </div>
      ) : null}

      <div className="two-col">
        <form className="card stack" onSubmit={(event) => void onSubmit(event)}>
          <h2 className="h2">{editingId ? "Modifier le responsable" : "Nouveau responsable"}</h2>
          {field("fullName", "Nom complet", "text", true)}
          {field("phone", "Téléphone principal", "tel")}
          {field("phoneSecondary", "Téléphone secondaire", "tel")}
          {field("email", "E-mail (nécessaire pour l'invitation)", "email")}
          {field("address", "Adresse")}
          <div className="row">
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {editingId ? "Enregistrer" : "Créer"}
            </button>
            {editingId ? (
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY);
                }}
              >
                Annuler
              </button>
            ) : null}
          </div>
        </form>

        <section className="card stack">
          <h2 className="h2">Enfants rattachés</h2>
          {!selected ? (
            <p className="muted">Sélectionnez un responsable dans la liste.</p>
          ) : (
            <>
              <strong>{selected.fullName}</strong>
              {selected.students.length === 0 ? <p className="muted">Aucun enfant rattaché.</p> : null}
              <ul className="list-reset stack">
                {selected.students.map((child) => (
                  <li key={child.id} className="row" style={{ justifyContent: "space-between" }}>
                    <span>
                      <Link href={`/students/${child.id}`}>{child.displayName}</Link>{" "}
                      <span className="muted">({child.relationship ?? "lien non précisé"})</span>
                      {child.isPrimary ? <span className="badge badge--active">Principal</span> : null}
                    </span>
                    <button
                      className="btn btn--ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => unlinkGuardian(selected.id, child.id), "Enfant détaché.")}
                    >
                      Détacher
                    </button>
                  </li>
                ))}
              </ul>
              <form className="stack" onSubmit={(event) => void onLink(event)}>
                <select className="select" value={childId} onChange={(e) => setChildId(e.target.value)} aria-label="Enfant">
                  <option value="">Ajouter un enfant…</option>
                  {students
                    .filter((student) => !linkedIds.has(student.id) && student.guardianCount < 2)
                    .map((student) => (
                      <option key={student.id} value={student.id}>
                        {student.displayName} · {student.studentCode}
                        {student.classroom ? ` · ${student.classroom.name}` : ""}
                      </option>
                    ))}
                </select>
                <input
                  className="input"
                  placeholder="Lien (mère, père, tuteur…)"
                  value={relationship}
                  onChange={(e) => setRelationship(e.target.value)}
                />
                <button className="btn btn--teal" type="submit" disabled={busy || !childId}>
                  Rattacher
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      <section className="card stack">
        <form
          className="row"
          onSubmit={(event) => {
            event.preventDefault();
            void load(search.trim());
          }}
        >
          <input
            className="input"
            placeholder="Nom, téléphone, e-mail ou élève"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Rechercher un responsable"
          />
          <button className="btn" type="submit">
            Rechercher
          </button>
        </form>
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : guardians.length === 0 ? (
          <p className="muted">Aucun responsable.</p>
        ) : (
          <table className="table table--stack">
            <thead>
              <tr>
                <th>Responsable</th>
                <th>Contacts</th>
                <th>Enfants</th>
                <th>Accès parent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {guardians.map((guardian) => (
                <tr key={guardian.id} aria-selected={selected?.id === guardian.id}>
                  <td data-label="Responsable">
                    <button className="btn btn--ghost" type="button" onClick={() => setSelected(guardian)}>
                      {guardian.fullName}
                    </button>
                  </td>
                  <td data-label="Contacts">
                    {[guardian.phone, guardian.phoneSecondary, guardian.email].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td data-label="Enfants">{guardian.students.map((child) => child.displayName).join(", ") || "—"}</td>
                  <td data-label="Accès parent">
                    {guardian.hasAccount ? (
                      <span className="badge badge--active">Compte actif</span>
                    ) : guardian.pendingInvitation ? (
                      <span className="badge badge--pending">Invitation envoyée</span>
                    ) : (
                      <span className="badge badge--muted">Aucun</span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <button className="btn btn--ghost" type="button" onClick={() => startEdit(guardian)}>
                        Modifier
                      </button>
                      {!guardian.hasAccount ? (
                        <button
                          className="btn"
                          type="button"
                          disabled={busy || !guardian.email || guardian.students.length === 0}
                          title={!guardian.email ? "E-mail requis" : guardian.students.length === 0 ? "Rattachez d'abord un enfant" : undefined}
                          onClick={() => void onInvite(guardian)}
                        >
                          {guardian.pendingInvitation ? "Réinviter" : "Inviter"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
