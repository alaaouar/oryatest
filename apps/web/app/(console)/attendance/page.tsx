"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, describeError, findSessions, listClassrooms, openSession } from "@/lib/api";
import { SLOT_LABEL, defaultSlot, formatCivilDate, formatDate, todayInMorocco } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { AttendanceSlot, ClassroomRow, SessionSummary } from "@/lib/types";

const SLOTS: AttendanceSlot[] = ["morning", "afternoon"];

/**
 * Lot 2.3 : point d'entrée de l'appel.
 * Direction : toutes les classes. Enseignant : uniquement ses classes affectées
 * (filtrage côté API). Choix de la date et du créneau, puis ouverture ou reprise.
 */
export default function AttendancePage() {
  const profile = useActiveProfile();
  const router = useRouter();
  const allowed = profile?.role === "direction" || profile?.role === "teacher";

  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [schoolYear, setSchoolYear] = useState<string>("");
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [classroomId, setClassroomId] = useState<string>("");
  const [date, setDate] = useState<string>(todayInMorocco());
  const [slot, setSlot] = useState<AttendanceSlot>(defaultSlot());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await listClassrooms();
        if (cancelled) return;
        setClassrooms(data.classrooms);
        setSchoolYear(data.schoolYear);
        if (data.classrooms.length === 1) {
          setClassroomId(data.classrooms[0].id);
        }
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(describeError(cause));
      } finally {
        if (!cancelled) setLoadingClasses(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  // t92 (CDC M3) : le rappel « appel non fait » ouvre /attendance?classe=...&date=AAAA-MM-JJ.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = params.get("date");
    if (fromLink && /^\d{4}-\d{2}-\d{2}$/.test(fromLink)) setDate(fromLink);
    const classe = params.get("classe");
    if (classe) setClassroomId(classe);
  }, []);

  const loadSessions = useCallback(async () => {
    if (!classroomId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setSessions([]);
      return;
    }
    setLoadingSessions(true);
    try {
      setSessions(await findSessions(classroomId, date));
      setError(null);
    } catch (cause) {
      setSessions([]);
      setError(describeError(cause));
    } finally {
      setLoadingSessions(false);
    }
  }, [classroomId, date]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const selected = useMemo(
    () => classrooms.find((classroom) => classroom.id === classroomId) ?? null,
    [classrooms, classroomId],
  );

  const openOrResume = useCallback(
    async (targetSlot: AttendanceSlot) => {
      if (!classroomId) return;
      const existing = sessions.find((session) => session.slot === targetSlot);
      if (existing) {
        router.push(`/attendance/${existing.id}`);
        return;
      }
      setOpening(true);
      try {
        const created = await openSession({ classroomId, date, slot: targetSlot });
        router.push(`/attendance/${created.id}`);
      } catch (cause) {
        // 409 : une session a été ouverte entre-temps (autre appareil) → on la reprend.
        if (cause instanceof ApiError && cause.status === 409) {
          const found = await findSessions(classroomId, date, targetSlot).catch(() => []);
          if (found[0]) {
            router.push(`/attendance/${found[0].id}`);
            return;
          }
        }
        setError(describeError(cause));
      } finally {
        setOpening(false);
      }
    },
    [classroomId, date, router, sessions],
  );

  if (!profile) {
    return null;
  }

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--warn" role="status">
          L&apos;appel est réservé à la direction et aux enseignants de l&apos;établissement.
        </div>
      </main>
    );
  }

  return (
    <main className="page stack">
      <div className="page-head">
        <div>
          <h1 className="h1">Présences</h1>
          <p className="subtitle">
            Choisissez une classe, une date et une demi-journée pour faire l&apos;appel
            {schoolYear ? ` · année ${schoolYear}` : ""}.
          </p>
        </div>
        {profile.role === "direction" ? (
          <Link className="btn" href="/assignments">
            Gérer les affectations
          </Link>
        ) : null}
      </div>

      {error ? (
        <p className="alert alert--error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="card stack" aria-labelledby="classes-title">
        <h2 className="h2" id="classes-title">
          {profile.role === "teacher" ? "Mes classes" : "Classes de l'établissement"}
        </h2>

        {loadingClasses ? <p className="muted">Chargement des classes…</p> : null}

        {!loadingClasses && classrooms.length === 0 ? (
          <div className="alert alert--warn" role="status">
            {profile.role === "teacher"
              ? "Aucune classe ne vous est affectée pour cette année scolaire. Contactez la direction."
              : "Aucune classe n'existe encore. Importez la liste des élèves pour créer les classes."}
          </div>
        ) : null}

        <div className="class-grid" role="list">
          {classrooms.map((classroom) => (
            <button
              key={classroom.id}
              type="button"
              role="listitem"
              className="class-card"
              aria-current={classroom.id === classroomId ? "true" : undefined}
              onClick={() => setClassroomId(classroom.id)}
            >
              <span className="class-card__name">{classroom.name}</span>
              <span className="muted">
                {[classroom.cycle, classroom.level].filter(Boolean).join(" · ") || "Classe"}
              </span>
              <span className="muted">
                {classroom.studentCount} élève{classroom.studentCount > 1 ? "s" : ""}
                {classroom.teachers.length > 0
                  ? ` · ${classroom.teachers.map((teacher) => teacher.displayName).join(", ")}`
                  : " · aucun enseignant affecté"}
              </span>
            </button>
          ))}
        </div>
      </section>

      {selected ? (
        <section className="card stack" aria-labelledby="day-title">
          <div className="filters">
            <label className="field">
              <span className="label">Date</span>
              <input
                className="input"
                type="date"
                value={date}
                max="2100-12-31"
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <div className="field">
              <span className="label">Demi-journée</span>
              <div className="seg" role="group" aria-label="Demi-journée">
                {SLOTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="seg__btn"
                    aria-pressed={slot === value}
                    onClick={() => setSlot(value)}
                  >
                    {SLOT_LABEL[value]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <h2 className="h2" id="day-title">
            {selected.name} · <span style={{ textTransform: "capitalize" }}>{formatCivilDate(date)}</span>
          </h2>

          {loadingSessions ? <p className="muted">Recherche des appels…</p> : null}

          <div className="slot-grid">
            {SLOTS.map((value) => {
              const session = sessions.find((entry) => entry.slot === value);
              return (
                <div key={value} className="slot-card" data-current={slot === value}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{SLOT_LABEL[value]}</strong>
                    {session ? (
                      <span className={session.status === "closed" ? "badge badge--muted" : "badge badge--active"}>
                        {session.status === "closed" ? "Clôturé" : "En cours"}
                      </span>
                    ) : (
                      <span className="badge badge--pending">Non commencé</span>
                    )}
                  </div>
                  <span className="muted">
                    {session
                      ? `${session.markedCount} / ${selected.studentCount} élèves marqués` +
                        (session.closedAt ? ` · clôturé le ${formatDate(session.closedAt)}` : "")
                      : `${selected.studentCount} élèves à appeler`}
                  </span>
                  <button
                    type="button"
                    className={slot === value ? "btn btn--primary" : "btn"}
                    disabled={opening || loadingSessions || (!session && selected.studentCount === 0)}
                    onClick={() => void openOrResume(value)}
                  >
                    {session
                      ? session.status === "closed"
                        ? "Consulter l'appel"
                        : "Reprendre l'appel"
                      : opening
                        ? "Ouverture…"
                        : "Commencer l'appel"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </main>
  );
}
