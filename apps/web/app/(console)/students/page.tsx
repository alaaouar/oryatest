"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { describeError, listClassrooms, listStudents } from "@/lib/api";
import { useActiveProfile } from "@/lib/session";
import type { ClassroomRow, StudentListRow } from "@/lib/types";

/** Lot 3 : liste des élèves (direction et enseignants). */
export default function StudentsPage() {
  const profile = useActiveProfile();
  const allowed = profile?.role === "direction" || profile?.role === "teacher" || profile?.role === "super_admin";

  const [students, setStudents] = useState<StudentListRow[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [search, setSearch] = useState("");
  const [classroomId, setClassroomId] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filters: { search: string; classroomId: string; unassigned: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      setStudents(await listStudents(filters));
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load({ search: "", classroomId: "", unassigned: false });
    listClassrooms()
      .then((data) => setClassrooms(data.classrooms))
      .catch(() => setClassrooms([]));
  }, [allowed, load]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load({ search: search.trim(), classroomId, unassigned });
  }

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">Cette page est réservée à l&apos;équipe de l&apos;établissement.</div>
      </main>
    );
  }

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Élèves</h1>
          <p className="subtitle">Recherche, classe actuelle et accès à la fiche de chaque élève.</p>
        </div>
        {profile?.role === "direction" ? (
          <Link className="btn btn--primary" href="/imports">
            Importer un fichier
          </Link>
        ) : null}
      </div>

      <form className="card filters" onSubmit={onSubmit}>
        <div className="field">
          <label className="label" htmlFor="search">
            Nom, code élève ou Massar
          </label>
          <input id="search" className="input" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="classroom">
            Classe
          </label>
          <select
            id="classroom"
            className="select"
            value={classroomId}
            onChange={(event) => setClassroomId(event.target.value)}
            disabled={unassigned}
          >
            <option value="">Toutes</option>
            {classrooms.map((classroom) => (
              <option key={classroom.id} value={classroom.id}>
                {classroom.name}
              </option>
            ))}
          </select>
        </div>
        <label className="row">
          <input type="checkbox" checked={unassigned} onChange={(event) => setUnassigned(event.target.checked)} />
          Sans classe cette année
        </label>
        <button className="btn btn--teal" type="submit" disabled={loading}>
          Rechercher
        </button>
      </form>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <section className="card">
        {loading ? (
          <p className="muted">Chargement…</p>
        ) : students.length === 0 ? (
          <p className="muted">Aucun élève ne correspond à cette recherche.</p>
        ) : (
          <>
            <p className="muted">{students.length} élève(s)</p>
            <table className="table table--stack">
              <thead>
                <tr>
                  <th>Élève</th>
                  <th>Code</th>
                  <th>Classe</th>
                  <th>Responsables</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student) => (
                  <tr key={student.id}>
                    <td data-label="Élève">
                      <Link href={`/students/${student.id}`}>{student.displayName}</Link>
                    </td>
                    <td data-label="Code" className="mono">
                      {student.studentCode}
                    </td>
                    <td data-label="Classe">
                      {student.classroom ? student.classroom.name : <span className="badge badge--pending">Sans classe</span>}
                    </td>
                    <td data-label="Responsables">
                      {student.guardianCount === 0 ? (
                        <span className="badge badge--absent">Aucun</span>
                      ) : (
                        `${student.guardianCount} / 2`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
}
