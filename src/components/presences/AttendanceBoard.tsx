"use client";

import { useEffect, useMemo, useState } from "react";
import {
  loadClassRegister,
  saveAttendanceRegister,
} from "@/app/presences/actions";
import {
  attendanceStatuses,
  type AttendanceStatus,
} from "@/lib/demo-attendance";
import { demoSchool } from "@/lib/demo-data";
import type {
  AttendanceClassesResult,
  AttendanceStudentRow,
} from "@/lib/attendance-types";

type Marks = Record<string, AttendanceStatus>;

const statusStyle: Record<AttendanceStatus, string> = {
  present:
    "border-orya-green bg-orya-green text-white hover:bg-orya-green",
  absent:
    "border-orya-orange bg-orya-orange text-white hover:bg-orya-orange",
  late: "border-orya-blue bg-orya-blue text-white hover:bg-orya-blue",
};

function emptyMarksFor(studentIds: string[]): Marks {
  return Object.fromEntries(studentIds.map((id) => [id, "present"]));
}

function marksEqual(a: Marks, b: Marks): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

export function AttendanceBoard({
  initialDate,
  initialLoad,
}: {
  initialDate: string;
  initialLoad: AttendanceClassesResult;
}) {
  const classes = useMemo(
    () => (initialLoad.ok ? initialLoad.data.classes : []),
    [initialLoad],
  );
  const schoolName = initialLoad.ok
    ? initialLoad.data.schoolName
    : demoSchool.name;
  const schoolCity = initialLoad.ok
    ? initialLoad.data.schoolCity
    : demoSchool.city;

  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [date, setDate] = useState(initialDate);
  const [students, setStudents] = useState<AttendanceStudentRow[]>([]);
  const [className, setClassName] = useState(classes[0]?.name ?? "");
  const [marks, setMarks] = useState<Marks>({});
  const [savedMarks, setSavedMarks] = useState<Marks | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(
    initialLoad.ok ? null : initialLoad.error,
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  const studentIds = useMemo(
    () => students.map((student) => student.id),
    [students],
  );
  const isDirty = savedMarks ? !marksEqual(marks, savedMarks) : true;
  const selectedMeta = classes.find((item) => item.id === classId);

  const counts = studentIds.reduce(
    (total, id) => {
      const status = marks[id] ?? "present";
      total[status] += 1;
      return total;
    },
    { present: 0, absent: 0, late: 0 },
  );

  useEffect(() => {
    if (!classId || !date) {
      return;
    }

    let cancelled = false;

    void loadClassRegister(classId, date).then((result) => {
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setError(result.error);
        return;
      }

      const nextMarks = {
        ...emptyMarksFor(result.data.students.map((student) => student.id)),
        ...result.data.marks,
      };
      setStudents(result.data.students);
      setClassName(result.data.className);
      setMarks(nextMarks);
      setSavedMarks(result.data.saved ? nextMarks : null);
    });

    return () => {
      cancelled = true;
    };
  }, [classId, date, classes]);

  function updateStatus(studentId: string, status: AttendanceStatus) {
    setMarks((current) => ({ ...current, [studentId]: status }));
    setFeedback(null);
  }

  async function saveRegister() {
    if (!classId || students.length === 0) {
      return;
    }

    setSaving(true);
    setError(null);
    const result = await saveAttendanceRegister(classId, date, marks);
    setSaving(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSavedMarks({ ...marks });
    setFeedback("Appel enregistré dans PostgreSQL pour cet établissement.");
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <p className="text-sm font-medium text-orya-blue">
        Présences et retards
      </p>
      <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight text-orya-night sm:text-3xl">
        Appel de classe
      </h1>
      <p className="mt-3 max-w-3xl text-base leading-7 text-orya-night/70">
        Établissement {schoolName} ({schoolCity}). Les élèves portent des
        libellés fictifs. Aucune identité réelle n&apos;est utilisée. Chaque
        école ne voit que ses propres classes.
      </p>
      <p className="mt-4 rounded-xl bg-orya-blue/8 px-4 py-3 text-sm leading-6 text-orya-night">
        {demoSchool.disclaimer} Les appels sont maintenant enregistrés dans
        PostgreSQL pour cet établissement de démonstration.
      </p>

      {error ? (
        <p className="orya-card mt-6 border-orya-orange px-4 py-3 text-sm text-orya-night">
          {error}
        </p>
      ) : null}

      <section className="orya-card mt-8 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-orya-night">
            Classe
            <select
              className="mt-2 w-full rounded-xl border border-orya-gray bg-white px-3 py-2.5 text-base font-normal text-orya-night"
              value={classId}
              onChange={(event) => {
                setClassId(event.target.value);
                setFeedback(null);
              }}
              disabled={classes.length === 0}
            >
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} — {item.cycle}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-orya-night">
            Date
            <input
              type="date"
              className="mt-2 w-full rounded-xl border border-orya-gray bg-white px-3 py-2.5 text-base font-normal text-orya-night"
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setFeedback(null);
              }}
            />
          </label>
        </div>
      </section>

      {selectedMeta && selectedMeta.studentCount === 0 ? (
        <section className="orya-card mt-8 border-dashed p-6">
          <h2 className="font-display text-lg font-semibold text-orya-night">
            Aucun élève dans cette classe
          </h2>
          <p className="mt-2 text-sm leading-6 text-orya-night/70">
            La classe « {selectedMeta.name} » est volontairement vide, pour
            montrer cet écran. Choisissez une autre classe pour faire l&apos;appel.
          </p>
        </section>
      ) : null}

      {selectedMeta && selectedMeta.studentCount > 0 ? (
        <>
          <section
            className="mt-8 grid gap-4 sm:grid-cols-3"
            aria-label="Récapitulatif"
          >
            <div className="orya-card p-5">
              <p className="text-sm font-medium text-orya-night/60">Présents</p>
              <p className="font-display mt-2 text-3xl font-semibold text-orya-green">
                {counts.present}
              </p>
            </div>
            <div className="orya-card p-5">
              <p className="text-sm font-medium text-orya-night/60">Absents</p>
              <p className="font-display mt-2 text-3xl font-semibold text-orya-orange">
                {counts.absent}
              </p>
            </div>
            <div className="orya-card p-5">
              <p className="text-sm font-medium text-orya-night/60">Retards</p>
              <p className="font-display mt-2 text-3xl font-semibold text-orya-blue">
                {counts.late}
              </p>
            </div>
          </section>

          <section className="orya-card mt-8 overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-orya-gray px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <h2 className="font-display text-lg font-semibold text-orya-night">
                  {className || selectedMeta.name}
                </h2>
                <p className="mt-1 text-sm text-orya-night/60">
                  {students.length} élèves fictifs · {date}
                </p>
              </div>
              <button
                type="button"
                className="orya-btn orya-btn-primary"
                onClick={() => {
                  void saveRegister();
                }}
                disabled={!isDirty || saving || students.length === 0}
              >
                {saving ? "Enregistrement…" : "Enregistrer l'appel"}
              </button>
            </div>

            {feedback ? (
              <p className="border-b border-orya-gray bg-orya-green/10 px-4 py-3 text-sm leading-6 text-orya-night sm:px-6">
                {feedback}
              </p>
            ) : (
              <p className="border-b border-orya-gray px-4 py-3 text-sm text-orya-night/65 sm:px-6">
                {savedMarks
                  ? isDirty
                    ? "Des modifications n'ont pas encore été enregistrées."
                    : "Appel enregistré dans PostgreSQL pour cet établissement."
                  : "Marquez chaque élève, puis enregistrez. L'appel est stocké pour cette école uniquement."}
              </p>
            )}

            <ul className="divide-y divide-orya-gray">
              {students.map((student) => {
                const status = marks[student.id] ?? "present";

                return (
                  <li
                    key={student.id}
                    className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                  >
                    <div>
                      <p className="font-medium text-orya-night">
                        {student.label}
                      </p>
                      <p className="text-sm text-orya-night/55">{student.code}</p>
                    </div>
                    <fieldset>
                      <legend className="sr-only">
                        Statut de {student.label}
                      </legend>
                      <div className="flex flex-wrap gap-2">
                        {attendanceStatuses.map((option) => {
                          const selected = status === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              aria-pressed={selected}
                              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
                                selected
                                  ? statusStyle[option.id]
                                  : "border-orya-gray bg-white text-orya-night hover:bg-slate-50"
                              }`}
                              onClick={() => updateStatus(student.id, option.id)}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
