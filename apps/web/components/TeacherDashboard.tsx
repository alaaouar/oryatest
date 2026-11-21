"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { describeError, listClassrooms } from "@/lib/api";
import type { ClassroomRow } from "@/lib/types";

export function TeacherDashboard() {
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listClassrooms()
      .then((data) => {
        setClassrooms(data.classrooms);
      })
      .catch((cause) => {
        setError(describeError(cause));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <section className="stack" style={{ gap: 24, marginBlock: 16 }}>
      {/* Raccourcis d'actions rapides enseignant */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <article className="card stack" style={{ borderTop: "3.5px solid var(--purple, #7c3aed)", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <span style={{ fontSize: 28 }}>📊</span>
              <h3 style={{ fontSize: 17, fontWeight: 800, marginTop: 8, marginBottom: 4 }}>
                Notes & Évaluations
              </h3>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Saisie des notes d&apos;examens, devoirs et contrôles pour vos classes.
              </p>
            </div>
          </div>
          <Link
            href="/resultats"
            className="btn btn--primary btn--sm"
            style={{ marginTop: 12, alignSelf: "flex-start", background: "var(--purple, #7c3aed)", color: "#fff" }}
          >
            Saisir les notes →
          </Link>
        </article>

        <article className="card stack" style={{ borderTop: "3.5px solid var(--teal, #12A7A0)", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <span style={{ fontSize: 28 }}>📋</span>
              <h3 style={{ fontSize: 17, fontWeight: 800, marginTop: 8, marginBottom: 4 }}>
                Feuille d&apos;appel
              </h3>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Pointer les présences, retards et absences de vos séances du jour.
              </p>
            </div>
          </div>
          <Link
            href="/attendance"
            className="btn btn--secondary btn--sm"
            style={{ marginTop: 12, alignSelf: "flex-start" }}
          >
            Faire l&apos;appel →
          </Link>
        </article>

        <article className="card stack" style={{ borderTop: "3.5px solid #0284c7", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <span style={{ fontSize: 28 }}>👥</span>
              <h3 style={{ fontSize: 17, fontWeight: 800, marginTop: 8, marginBottom: 4 }}>
                Mes Élèves
              </h3>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Consulter les fiches de vos élèves, leur assiduité et leurs résultats.
              </p>
            </div>
          </div>
          <Link
            href="/students"
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 12, alignSelf: "flex-start" }}
          >
            Voir la liste →
          </Link>
        </article>
      </div>

      {/* Mes classes affectées */}
      <section className="card stack" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 className="h2" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              Mes Classes Enseignées
            </h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 0 }}>
              Accédez directement à la saisie des notes et aux présences par classe.
            </p>
          </div>
        </div>

        {error ? <div className="alert alert--error">{error}</div> : null}

        {loading ? (
          <p className="muted" style={{ fontSize: 13 }}>Chargement de vos classes…</p>
        ) : classrooms.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Aucune classe ne vous est affectée pour cette année scolaire. Contactez la direction pour vos affectations.
          </p>
        ) : (
          <ul className="list-reset stack" style={{ gap: 12, marginTop: 10 }}>
            {classrooms.map((c) => (
              <li
                key={c.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                  padding: "14px 18px",
                  borderRadius: "var(--radius-sm, 8px)",
                  border: "1px solid var(--line, #e2e8f0)",
                  background: "#ffffff",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 15, color: "#1e293b" }}>{c.name}</strong>
                    {c.level ? (
                      <span className="badge badge--purple" style={{ fontSize: 11, padding: "2px 8px" }}>
                        {c.level}
                      </span>
                    ) : null}
                    {c.cycle ? (
                      <span className="badge" style={{ fontSize: 11, padding: "2px 8px" }}>
                        {c.cycle}
                      </span>
                    ) : null}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    {c.studentCount} élève(s) inscrit(s)
                  </div>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  <Link
                    href={`/resultats?classroomId=${c.id}`}
                    className="btn btn--sm"
                    style={{ background: "#f3e8ff", color: "#6b21a8", fontWeight: 700 }}
                  >
                    📊 Saisir les notes
                  </Link>
                  <Link
                    href={`/attendance?classroomId=${c.id}`}
                    className="btn btn--ghost btn--sm"
                    style={{ fontSize: 12 }}
                  >
                    📋 Présences
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
