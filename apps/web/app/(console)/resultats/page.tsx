"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  createAssessment,
  deleteAssessment,
  describeError,
  getAssessment,
  listAssessments,
  listClassrooms,
  publishAssessment,
  setAssessmentScores,
} from "@/lib/api";
import { formatCivilDate, todayInMorocco } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { AssessmentDetail, AssessmentView, ClassroomRow } from "@/lib/types";

type Notice = { tone: "ok" | "error" | "info"; text: string } | null;
type Draft = Record<string, { score: string; absent: boolean; comment: string }>;

const COMMON_SUBJECTS = [
  "Mathématiques",
  "Physique-Chimie",
  "Sciences de la Vie et de la Terre (SVT)",
  "Français",
  "Langue Arabe",
  "Anglais",
  "Histoire-Géographie",
  "Philosophie",
  "Éducation Islamique",
  "Informatique",
];

const QUICK_TITLES = [
  "Contrôle Continu N°1",
  "Contrôle Continu N°2",
  "Contrôle Continu N°3",
  "Devoir Surveillé",
  "Examen Blanc",
  "Évaluation Diagnostique",
];

const QUICK_APPRECIATIONS = [
  "Excellent travail",
  "Très bon travail",
  "Bon travail",
  "Travail satisfaisant",
  "Efforts à poursuivre",
  "Manque de travail",
];

export default function ResultsPage() {
  const searchParams = useSearchParams();
  const profile = useActiveProfile();
  const allowed = profile?.role === "direction" || profile?.role === "teacher";

  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [classroomId, setClassroomId] = useState("");
  const [assessments, setAssessments] = useState<AssessmentView[]>([]);
  const [current, setCurrent] = useState<AssessmentDetail | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayInMorocco());
  const [maxScore, setMaxScore] = useState("20");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [assessmentFilter, setAssessmentFilter] = useState<"all" | "draft" | "published">("all");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Chargement des classes affectées à l'enseignant (ou toutes les classes pour la direction)
  useEffect(() => {
    if (!allowed) return;
    listClassrooms()
      .then((data) => {
        setClassrooms(data.classrooms);
        const queryClassId = searchParams.get("classroomId");
        if (queryClassId && data.classrooms.some((c) => c.id === queryClassId)) {
          setClassroomId(queryClassId);
        } else if (data.classrooms.length > 0) {
          setClassroomId((c) => c || data.classrooms[0].id);
        }
      })
      .catch((cause) => setNotice({ tone: "error", text: describeError(cause) }));
  }, [allowed, searchParams]);

  const loadList = useCallback(async (id: string) => {
    const data = await listAssessments(id);
    setAssessments(data.assessments);
  }, []);

  useEffect(() => {
    if (!classroomId) return;
    loadList(classroomId).catch((cause) => setNotice({ tone: "error", text: describeError(cause) }));
  }, [classroomId, loadList]);

  function fill(detail: AssessmentDetail) {
    setCurrent(detail);
    const next: Draft = {};
    for (const s of detail.students) {
      next[s.studentId] = {
        score: s.score === null ? "" : String(s.score),
        absent: s.absent,
        comment: s.comment ?? "",
      };
    }
    setDraft(next);
  }

  async function open(id: string) {
    setNotice(null);
    try {
      fill(await getAssessment(id));
      window.scrollTo({ top: 380, behavior: "smooth" });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    }
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const created = await createAssessment({
        classroomId,
        subject: subject.trim(),
        title: title.trim(),
        date,
        maxScore: Number(maxScore),
      });
      setSubject("");
      setTitle("");
      setShowCreateForm(false);
      await loadList(classroomId);
      await open(created.id);
      setNotice({
        tone: "ok",
        text: `Évaluation « ${created.subject} - ${created.title} » créée avec succès ! Vous pouvez maintenant saisir les notes des élèves ci-dessous.`,
      });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!current) return;
    setBusy(true);
    setNotice(null);
    try {
      const scores = current.students
        .filter((s) => draft[s.studentId] && (draft[s.studentId].absent || draft[s.studentId].score.trim() !== ""))
        .map((s) => {
          const d = draft[s.studentId];
          return {
            studentId: s.studentId,
            absent: d.absent,
            score: d.absent ? null : Number(d.score.replace(",", ".")),
            comment: d.comment.trim() || undefined,
          };
        });

      if (scores.length === 0) {
        setNotice({ tone: "error", text: "Veuillez saisir au moins une note ou marquer un élève absent." });
        return;
      }

      fill(await setAssessmentScores(current.id, scores));
      await loadList(classroomId);
      setNotice({ tone: "ok", text: "✓ Notes et appréciations enregistrées dans le brouillon." });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function onPublish() {
    if (!current) return;
    if (
      !window.confirm(
        "Confirmer la publication des notes aux familles et aux élèves ? Ils recevront une notification in-app immédiate.",
      )
    ) {
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      const result = await publishAssessment(current.id);
      await open(current.id);
      await loadList(classroomId);
      setNotice({
        tone: "ok",
        text: `🎉 Résultats publiés avec succès ! ${result.familiesNotified} famille(s) et les élèves ont été notifiés.`,
      });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(assessmentId: string) {
    if (
      !window.confirm(
        "Êtes-vous sûr de vouloir supprimer cette évaluation ? Toutes les notes associées seront effacées.",
      )
    ) {
      return;
    }

    setBusy(true);
    setNotice(null);
    try {
      await deleteAssessment(assessmentId);
      if (current?.id === assessmentId) {
        setCurrent(null);
      }
      await loadList(classroomId);
      setNotice({ tone: "ok", text: "Évaluation supprimée." });
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  // Statistiques en direct sur les notes saisies
  const stats = useMemo(() => {
    if (!current) return null;
    const scores: number[] = [];
    let absentCount = 0;
    let missingCount = 0;

    for (const s of current.students) {
      const d = draft[s.studentId];
      if (d?.absent) {
        absentCount++;
      } else if (d?.score !== undefined && d.score.trim() !== "") {
        const val = Number(d.score.replace(",", "."));
        if (!Number.isNaN(val) && val >= 0 && val <= current.maxScore) {
          scores.push(val);
        } else {
          missingCount++;
        }
      } else {
        missingCount++;
      }
    }

    const total = current.students.length;
    const gradedCount = scores.length;
    const avg = gradedCount > 0 ? scores.reduce((a, b) => a + b, 0) / gradedCount : null;
    const max = gradedCount > 0 ? Math.max(...scores) : null;
    const min = gradedCount > 0 ? Math.min(...scores) : null;
    const passThreshold = current.maxScore / 2;
    const passCount = scores.filter((v) => v >= passThreshold).length;
    const passRate = gradedCount > 0 ? Math.round((passCount / gradedCount) * 100) : null;

    return { total, gradedCount, absentCount, missingCount, avg, max, min, passRate, passThreshold };
  }, [current, draft]);

  // Filtrage des évaluations
  const filteredAssessments = useMemo(() => {
    return assessments.filter((a) => {
      if (assessmentFilter === "draft") return !a.publishedAt;
      if (assessmentFilter === "published") return Boolean(a.publishedAt);
      return true;
    });
  }, [assessments, assessmentFilter]);

  // Filtrage des élèves dans l'évaluation en cours
  const displayedStudents = useMemo(() => {
    if (!current) return [];
    if (!filterQuery.trim()) return current.students;
    const q = filterQuery.toLowerCase();
    return current.students.filter(
      (s) => s.displayName.toLowerCase().includes(q) || s.studentCode.toLowerCase().includes(q),
    );
  }, [current, filterQuery]);

  // Navigation clavier ultra-rapide (Enter / Fleche bas / Fleche haut)
  const handleScoreKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      const nextStudent = displayedStudents[index + 1];
      if (nextStudent) {
        inputRefs.current[nextStudent.studentId]?.focus();
        inputRefs.current[nextStudent.studentId]?.select();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevStudent = displayedStudents[index - 1];
      if (prevStudent) {
        inputRefs.current[prevStudent.studentId]?.focus();
        inputRefs.current[prevStudent.studentId]?.select();
      }
    }
  };

  const selectedClassroom = classrooms.find((c) => c.id === classroomId);

  if (!allowed) {
    return (
      <main className="page">
        <div className="alert alert--error">Cette page est réservée aux enseignants et à la direction.</div>
      </main>
    );
  }

  return (
    <main className="page stack">
      {/* En-tête */}
      <div className="page-head">
        <div>
          <h1 className="h1" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Évaluations & Saisie des Notes
          </h1>
          <p className="subtitle" style={{ fontSize: 14 }}>
            Saisissez les notes d&apos;examens, devoirs et contrôles continus de vos élèves. Les notes restent sous forme de brouillon modifiable jusqu&apos;à publication aux familles.
          </p>
        </div>
      </div>

      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}

      {/* Sélection de la Classe & Bouton Créer une Évaluation */}
      <section className="card stack" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ flex: "1 1 280px" }}>
            <label className="label" htmlFor="r-class" style={{ fontWeight: 700 }}>
              Sélectionnez votre classe :
            </label>
            <select
              id="r-class"
              className="input"
              value={classroomId}
              onChange={(e) => {
                setClassroomId(e.target.value);
                setCurrent(null);
              }}
              style={{ fontWeight: 600, fontSize: 15 }}
            >
              {classrooms.length === 0 ? (
                <option value="">Aucune classe affectée</option>
              ) : (
                classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.level ? `(${c.level})` : ""} · {c.studentCount} élève(s)
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            type="button"
            className="btn btn--primary"
            style={{ background: "var(--purple, #7c3aed)", color: "#fff", fontWeight: 700, padding: "10px 18px" }}
            onClick={() => setShowCreateForm((prev) => !prev)}
            disabled={!classroomId}
          >
            {showCreateForm ? "✕ Fermer le formulaire" : "＋ Nouvelle Évaluation / Examen"}
          </button>
        </div>

        {/* Formulaire de création d'évaluation (dépliable) */}
        {showCreateForm ? (
          <form
            onSubmit={onCreate}
            className="stack"
            style={{
              marginTop: 16,
              padding: 18,
              borderRadius: 8,
              border: "1.5px solid var(--purple, #7c3aed)",
              background: "#faf5ff",
              gap: 14,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0, color: "#581c87" }}>
              Programmer un contrôle ou un examen pour {selectedClassroom?.name}
            </h3>

            {/* Suggestions rapides d'intitulé */}
            <div>
              <span className="muted" style={{ fontSize: 12, display: "block", marginBottom: 6 }}>
                Suggestions d&apos;intitulé rapide :
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {QUICK_TITLES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ fontSize: 11, padding: "3px 8px", background: "#ffffff" }}
                    onClick={() => setTitle(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div className="field">
                <label className="label" htmlFor="r-subject">
                  Matière :
                </label>
                <input
                  id="r-subject"
                  className="input"
                  list="subjects-list"
                  placeholder="Ex : Mathématiques"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  minLength={2}
                  maxLength={80}
                  required
                />
                <datalist id="subjects-list">
                  {COMMON_SUBJECTS.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>

              <div className="field">
                <label className="label" htmlFor="r-title">
                  Intitulé du devoir / contrôle :
                </label>
                <input
                  id="r-title"
                  className="input"
                  placeholder="Ex : Contrôle Continu N°1 - Algèbre"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  minLength={2}
                  maxLength={120}
                  required
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="r-date">
                  Date de l&apos;évaluation :
                </label>
                <input
                  id="r-date"
                  className="input"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label className="label" htmlFor="r-max">
                  Barème (Note max) :
                </label>
                <input
                  id="r-max"
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  value={maxScore}
                  onChange={(e) => setMaxScore(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="row" style={{ gap: 10, marginTop: 4 }}>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy || !classroomId}
                style={{ background: "#16a34a", color: "#fff", fontWeight: 700 }}
              >
                {busy ? "Création…" : "✓ Valider et ouvrir la saisie des notes"}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setShowCreateForm(false)}
              >
                Annuler
              </button>
            </div>
          </form>
        ) : null}
      </section>

      {/* Liste des Évaluations de la classe sélectionnée */}
      <section className="card stack" style={{ padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 className="h2" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
              Évaluations de la classe ({assessments.length})
            </h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 2, marginBottom: 0 }}>
              Cliquez sur une évaluation pour consulter ou modifier les notes des élèves.
            </p>
          </div>

          {/* Filtres Brouillons / Publiées */}
          <div className="seg" role="tablist">
            <button
              type="button"
              className="seg__btn"
              aria-selected={assessmentFilter === "all"}
              onClick={() => setAssessmentFilter("all")}
            >
              Toutes ({assessments.length})
            </button>
            <button
              type="button"
              className="seg__btn"
              aria-selected={assessmentFilter === "draft"}
              onClick={() => setAssessmentFilter("draft")}
            >
              Brouillons ({assessments.filter((a) => !a.publishedAt).length})
            </button>
            <button
              type="button"
              className="seg__btn"
              aria-selected={assessmentFilter === "published"}
              onClick={() => setAssessmentFilter("published")}
            >
              Publiées ({assessments.filter((a) => a.publishedAt).length})
            </button>
          </div>
        </div>

        {filteredAssessments.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            {assessments.length === 0
              ? "Aucune évaluation enregistrée pour cette classe. Utilisez le bouton « ＋ Nouvelle Évaluation » ci-dessus pour commencer."
              : "Aucune évaluation ne correspond au filtre sélectionné."}
          </p>
        ) : (
          <ul className="list-reset stack" style={{ gap: 10, marginTop: 10 }}>
            {filteredAssessments.map((a) => {
              const isSelected = current?.id === a.id;
              return (
                <li
                  key={a.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 12,
                    padding: "12px 16px",
                    borderRadius: "var(--radius-sm, 6px)",
                    border: isSelected ? "2px solid var(--purple, #7c3aed)" : "1px solid var(--line, #e2e8f0)",
                    background: isSelected ? "#faf5ff" : "#ffffff",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 15, color: "#1e293b" }}>{a.subject}</strong>
                      <span className="muted">·</span>
                      <span style={{ fontWeight: 600 }}>{a.title}</span>
                      {a.publishedAt ? (
                        <span className="badge badge--active" style={{ fontSize: 11, padding: "2px 8px" }}>
                          ✓ Publiée aux familles
                        </span>
                      ) : (
                        <span className="badge badge--pending" style={{ fontSize: 11, padding: "2px 8px" }}>
                          📝 Brouillon non publié
                        </span>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      Date : {formatCivilDate(a.date)} · Barème : /{a.maxScore} · {a.resultCount} note(s) saisie(s)
                    </div>
                  </div>

                  <div className="row" style={{ gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn--sm"
                      style={{
                        background: isSelected ? "var(--purple, #7c3aed)" : "#f1f5f9",
                        color: isSelected ? "#fff" : "#1e293b",
                        fontWeight: 700,
                      }}
                      onClick={() => void open(a.id)}
                    >
                      {isSelected ? "✏️ Saisie en cours" : "✏️ Saisir / Consulter"}
                    </button>

                    {!a.publishedAt ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        style={{ color: "#dc2626" }}
                        onClick={() => void onDelete(a.id)}
                        disabled={busy}
                        title="Supprimer cette évaluation"
                      >
                        🗑️
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Panneau de saisie des notes de l'évaluation sélectionnée */}
      {current ? (
        <section
          className="card stack"
          style={{
            padding: 24,
            border: "2px solid var(--purple, #7c3aed)",
            background: "#ffffff",
            boxShadow: "0 4px 14px rgba(124,58,237,0.08)",
          }}
        >
          {/* En-tête de la séance de notation */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="badge badge--purple" style={{ fontSize: 12, padding: "4px 10px" }}>
                  {current.classroom}
                </span>
                <h2 className="h2" style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1e1b4b" }}>
                  {current.subject} · {current.title}
                </h2>
                {current.publishedAt ? (
                  <span className="badge badge--active" style={{ fontSize: 12, padding: "4px 10px" }}>
                    ✓ Publiée le {formatCivilDate(String(current.publishedAt).slice(0, 10))}
                  </span>
                ) : (
                  <span className="badge badge--pending" style={{ fontSize: 12, padding: "4px 10px" }}>
                    📝 Brouillon (modifiable librement)
                  </span>
                )}
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: 6, marginBottom: 0 }}>
                Date du contrôle : <strong>{formatCivilDate(current.date)}</strong> · Barème officiel : <strong>/{current.maxScore}</strong> · Total : <strong>{current.students.length} élèves</strong>
              </p>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => window.print()}
                title="Imprimer la feuille de notes"
              >
                🖨️ Imprimer
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setCurrent(null)}
              >
                ✕ Fermer
              </button>
            </div>
          </div>

          {/* Barre des Statistiques de classe en direct */}
          {stats && stats.gradedCount > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: 10,
                background: "#f8fafc",
                padding: "12px 16px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
              }}
            >
              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", fontWeight: 700 }}>
                  Moyenne classe
                </span>
                <div style={{ fontSize: 18, fontWeight: 800, color: (stats.avg ?? 0) >= stats.passThreshold ? "#059669" : "#dc2626" }}>
                  {stats.avg?.toFixed(2)} <span style={{ fontSize: 12 }}>/{current.maxScore}</span>
                </div>
              </div>

              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", fontWeight: 700 }}>
                  Meilleure note
                </span>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0284c7" }}>
                  {stats.max?.toFixed(1)} <span style={{ fontSize: 12 }}>/{current.maxScore}</span>
                </div>
              </div>

              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", fontWeight: 700 }}>
                  Note la plus basse
                </span>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#64748b" }}>
                  {stats.min?.toFixed(1)} <span style={{ fontSize: 12 }}>/{current.maxScore}</span>
                </div>
              </div>

              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", fontWeight: 700 }}>
                  Taux de réussite
                </span>
                <div style={{ fontSize: 18, fontWeight: 800, color: (stats.passRate ?? 0) >= 50 ? "#059669" : "#d97706" }}>
                  {stats.passRate}% <span style={{ fontSize: 12 }}>(≥{stats.passThreshold})</span>
                </div>
              </div>

              <div>
                <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", fontWeight: 700 }}>
                  Progression saisie
                </span>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>
                  {stats.gradedCount} / {stats.total} <span style={{ fontSize: 12 }}>noté(s)</span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Barre de recherche d'élève & aide clavier */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <input
              type="text"
              className="input"
              placeholder="🔍 Filtrer un élève par son nom ou code..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              style={{ maxWidth: 300, fontSize: 13 }}
            />
            <span className="muted" style={{ fontSize: 12 }}>
              💡 <strong>Astuce saisie rapide :</strong> Tapez la note puis appuyez sur <strong>Entrée ↵</strong> pour passer automatiquement à l&apos;élève suivant.
            </span>
          </div>

          {/* Tableau de saisie des notes */}
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ width: "100%", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ width: "60px", textAlign: "center" }}>N°</th>
                  <th style={{ minWidth: "180px" }}>Élève</th>
                  <th style={{ width: "140px" }}>Note (/{current.maxScore})</th>
                  <th style={{ width: "90px", textAlign: "center" }}>Absent</th>
                  <th style={{ minWidth: "260px" }}>Appréciation / Commentaire</th>
                </tr>
              </thead>
              <tbody>
                {displayedStudents.map((s, idx) => {
                  const d = draft[s.studentId] ?? { score: "", absent: false, comment: "" };
                  const set = (patch: Partial<typeof d>) =>
                    setDraft((all) => ({ ...all, [s.studentId]: { ...d, ...patch } }));

                  const numericScore = d.absent ? null : Number(d.score.replace(",", "."));
                  const isOutOfRange =
                    numericScore !== null &&
                    !Number.isNaN(numericScore) &&
                    (numericScore < 0 || numericScore > current.maxScore);

                  return (
                    <tr
                      key={s.studentId}
                      style={{
                        background: d.absent ? "#f8fafc" : numericScore !== null && !Number.isNaN(numericScore) ? "#ffffff" : "#fffbeb",
                      }}
                    >
                      <td style={{ textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                        {idx + 1}
                      </td>

                      <td>
                        <div style={{ fontWeight: 700, color: "#1e293b" }}>{s.displayName}</div>
                        <div className="muted" style={{ fontSize: 11 }}>Code : {s.studentCode}</div>
                      </td>

                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <input
                            ref={(el) => {
                              inputRefs.current[s.studentId] = el;
                            }}
                            className="input"
                            inputMode="decimal"
                            style={{
                              width: 85,
                              fontWeight: 800,
                              fontSize: 15,
                              textAlign: "center",
                              borderColor: isOutOfRange ? "#dc2626" : undefined,
                              background: d.absent ? "#e2e8f0" : "#ffffff",
                            }}
                            disabled={d.absent}
                            placeholder="—"
                            value={d.score}
                            onChange={(e) => set({ score: e.target.value })}
                            onKeyDown={(e) => handleScoreKeyDown(e, idx)}
                            aria-label={`Note de ${s.displayName}`}
                          />
                          <span className="muted" style={{ fontSize: 12 }}>/{current.maxScore}</span>
                        </div>
                        {isOutOfRange ? (
                          <span style={{ color: "#dc2626", fontSize: 11, display: "block", marginTop: 2 }}>
                            Max : {current.maxScore}
                          </span>
                        ) : null}
                      </td>

                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={d.absent}
                          onChange={(e) => {
                            const isAbs = e.target.checked;
                            set({ absent: isAbs, score: isAbs ? "" : d.score });
                          }}
                          aria-label={`${s.displayName} absent`}
                          style={{ width: 18, height: 18, cursor: "pointer" }}
                        />
                      </td>

                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <input
                            className="input"
                            maxLength={300}
                            placeholder="Appréciation (ex : Excellent travail, efforts constatés...)"
                            value={d.comment}
                            onChange={(e) => set({ comment: e.target.value })}
                            aria-label={`Commentaire pour ${s.displayName}`}
                            style={{ fontSize: 13 }}
                          />
                          {/* Suggestions rapides d'appréciation pour cet élève */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {QUICK_APPRECIATIONS.slice(0, 3).map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                style={{
                                  fontSize: 10,
                                  background: "#f1f5f9",
                                  border: "1px solid #cbd5e1",
                                  borderRadius: 4,
                                  padding: "1px 5px",
                                  cursor: "pointer",
                                  color: "#475569",
                                }}
                                onClick={() => set({ comment: chip })}
                              >
                                {chip}
                              </button>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Boutons d'action : Enregistrer / Publier */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              paddingTop: 16,
              borderTop: "1px solid #e2e8f0",
              marginTop: 10,
            }}
          >
            <div className="row" style={{ gap: 10 }}>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                style={{ background: "var(--purple, #7c3aed)", color: "#fff", fontWeight: 700, padding: "10px 20px" }}
                onClick={() => void onSave()}
              >
                {busy ? "Enregistrement…" : "💾 Enregistrer le brouillon des notes"}
              </button>

              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  // Marquer tous les élèves non saisis comme absents
                  const nextDraft: Draft = { ...draft };
                  for (const s of current.students) {
                    if (!nextDraft[s.studentId]?.score && !nextDraft[s.studentId]?.absent) {
                      nextDraft[s.studentId] = {
                        score: "",
                        absent: true,
                        comment: "Absent(e) lors du devoir",
                      };
                    }
                  }
                  setDraft(nextDraft);
                }}
              >
                Marquer les non notés comme absents
              </button>
            </div>

            <div>
              {current.publishedAt ? (
                <span className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                  <span>✓</span> Évaluation publiée. Toute modification ultérieure reste enregistrée et auditée.
                </span>
              ) : (
                <button
                  type="button"
                  className="btn"
                  disabled={busy || current.resultCount === 0}
                  style={{ background: "#059669", color: "#fff", fontWeight: 700, padding: "10px 20px" }}
                  onClick={() => void onPublish()}
                >
                  📢 Publier les notes aux familles & élèves
                </button>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
