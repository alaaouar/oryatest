"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAssignment,
  deleteAssignment,
  describeError,
  listAssignments,
  listClassrooms,
  listTeachers,
} from "@/lib/api";
import { formatDate } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { AssignmentRow, ClassroomRow, TeacherRow } from "@/lib/types";

type Notice = { tone: "ok" | "error"; text: string } | null;

/** Lot 2.3 : affectation des enseignants aux classes (direction, MFA requise). */
export default function AssignmentsPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "direction";

  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [schoolYear, setSchoolYear] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingDelete, setPendingDelete] = useState<AssignmentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [assignmentList, teacherList, classroomData] = await Promise.all([
        listAssignments(),
        listTeachers(),
        listClassrooms(),
      ]);
      setAssignments(assignmentList);
      setTeachers(teacherList);
      setClassrooms(classroomData.classrooms);
      setSchoolYear((current) => current || classroomData.schoolYear);
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const yearAssignments = useMemo(
    () => assignments.filter((assignment) => !schoolYear || assignment.schoolYear === schoolYear),
    [assignments, schoolYear],
  );

  const duplicate = useMemo(
    () =>
      yearAssignments.some(
        (assignment) => assignment.teacherProfileId === teacherId && assignment.classroomId === classroomId,
      ),
    [yearAssignments, teacherId, classroomId],
  );

  const submit = async () => {
    if (!teacherId || !classroomId || !/^\d{4}-\d{4}$/.test(schoolYear)) {
      setNotice({ tone: "error", text: "Choisissez un enseignant, une classe et une année au format 2026-2027." });
      return;
    }
    setBusy(true);
    try {
      await createAssignment({ teacherProfileId: teacherId, classroomId, schoolYear });
      const teacher = teachers.find((entry) => entry.id === teacherId)?.displayName ?? "L'enseignant";
      const classroom = classrooms.find((entry) => entry.id === classroomId)?.name ?? "la classe";
      setNotice({ tone: "ok", text: `${teacher} est affecté(e) à ${classroom} pour ${schoolYear}.` });
      setClassroomId("");
      await load();
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await deleteAssignment(pendingDelete.id);
      setNotice({
        tone: "ok",
        text: `Affectation retirée : ${pendingDelete.teacherProfile.displayName} · ${pendingDelete.classroom.name}. Les appels déjà saisis sont conservés.`,
      });
      setPendingDelete(null);
      await load();
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
      setPendingDelete(null);
    } finally {
      setBusy(false);
    }
  };

  if (!profile) return null;

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--warn" role="status">
          La gestion des affectations est réservée à la direction de l&apos;établissement.
        </div>
      </main>
    );
  }

  return (
    <main className="page stack">
      <div>
        <h1 className="h1">Affectations enseignants</h1>
        <p className="subtitle">
          Un enseignant ne peut faire l&apos;appel que dans les classes qui lui sont affectées pour l&apos;année scolaire.
        </p>
      </div>

      {notice ? (
        <p className={`alert alert--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      <section className="card stack" aria-labelledby="new-title">
        <h2 className="h2" id="new-title">
          Nouvelle affectation
        </h2>
        {!loading && teachers.length === 0 ? (
          <div className="alert alert--warn" role="status">
            Aucun enseignant n&apos;a encore de compte dans l&apos;établissement. Invitez d&apos;abord vos enseignants.
          </div>
        ) : null}
        <div className="filters">
          <label className="field">
            <span className="label">Enseignant</span>
            <select className="select" value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
              <option value="">Choisir…</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Classe</span>
            <select className="select" value={classroomId} onChange={(event) => setClassroomId(event.target.value)}>
              <option value="">Choisir…</option>
              {classrooms.map((classroom) => (
                <option key={classroom.id} value={classroom.id}>
                  {classroom.name} ({classroom.studentCount} élèves)
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Année scolaire</span>
            <input
              className="input"
              value={schoolYear}
              onChange={(event) => setSchoolYear(event.target.value)}
              placeholder="2026-2027"
              inputMode="numeric"
            />
          </label>
          <button
            className="btn btn--primary"
            type="button"
            disabled={busy || loading || !teacherId || !classroomId || duplicate}
            onClick={() => void submit()}
          >
            {busy ? "Enregistrement…" : "Affecter"}
          </button>
        </div>
        {duplicate ? <p className="hint">Cette affectation existe déjà pour {schoolYear}.</p> : null}
        <p className="hint">Opération sensible : une session direction avec double authentification est requise.</p>
      </section>

      <section className="card" aria-labelledby="list-title">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2 className="h2" id="list-title">
            {yearAssignments.length} affectation{yearAssignments.length > 1 ? "s" : ""}
            {schoolYear ? ` · ${schoolYear}` : ""}
          </h2>
          <button className="btn" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Chargement…" : "Actualiser"}
          </button>
        </div>
        <table className="table table--stack">
          <thead>
            <tr>
              <th>Enseignant</th>
              <th>Classe</th>
              <th>Année</th>
              <th>Depuis</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {yearAssignments.map((assignment) => (
              <tr key={assignment.id}>
                <td style={{ fontWeight: 600 }}>{assignment.teacherProfile.displayName}</td>
                <td>{assignment.classroom.name}</td>
                <td>{assignment.schoolYear}</td>
                <td className="muted">{formatDate(assignment.createdAt)}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn btn--ghost" type="button" disabled={busy} onClick={() => setPendingDelete(assignment)}>
                    Retirer
                  </button>
                </td>
              </tr>
            ))}
            {yearAssignments.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className="muted">
                  Aucune affectation pour cette année.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {pendingDelete ? (
        <div className="modal-backdrop" role="presentation" onClick={() => !busy && setPendingDelete(null)}>
          <div
            className="card modal stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="h2" id="delete-title">
              Retirer l&apos;affectation ?
            </h2>
            <p style={{ margin: 0 }}>
              {pendingDelete.teacherProfile.displayName} ne pourra plus faire l&apos;appel en {pendingDelete.classroom.name}.
              Les appels déjà enregistrés sont conservés.
            </p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn" type="button" disabled={busy} onClick={() => setPendingDelete(null)}>
                Annuler
              </button>
              <button className="btn btn--primary" type="button" disabled={busy} onClick={() => void confirmDelete()}>
                Retirer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
