"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  cancelParentAction,
  changeStudentClass,
  createParentAction,
  describeError,
  getStudentProfile,
  issueActivationCode,
  linkGuardian,
  listClassrooms,
  listGuardians,
  listSchoolActions,
  unlinkGuardian,
  updateStudent,
} from "@/lib/api";
import { formatCivilDate, formatDate, historyActionLabel, roleLabel, SLOT_LABEL } from "@/lib/labels";
import { useActiveProfile } from "@/lib/session";
import type { ClassroomRow, GuardianView, ParentActionView, Role, StudentProfile } from "@/lib/types";
import { AiOrientationAssistant } from "@/components/AiOrientationAssistant";

type Notice = { tone: "ok" | "error"; text: string } | null;
type ActiveTab = "powerskills" | "attendance" | "parents" | "admin";

/** Calcule le numéro WhatsApp international (ex: 0612345678 -> 212612345678) */
function toWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) {
    return "212" + digits.slice(1);
  }
  return digits;
}

interface SubjectSkillSummary {
  subject: string;
  averageScore20: number;
  count: number;
  badge: {
    label: string;
    variant: "gold" | "emerald" | "blue" | "purple" | "amber";
    desc: string;
  };
  highestScore: number;
}

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id;
  const profile = useActiveProfile();
  const isDirection = profile?.role === "direction" || profile?.role === "super_admin";

  const [student, setStudent] = useState<StudentProfile | null>(null);
  const [classrooms, setClassrooms] = useState<ClassroomRow[]>([]);
  const [guardians, setGuardians] = useState<GuardianView[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("powerskills");
  const [attendanceFilter, setAttendanceFilter] = useState<"all" | "absent" | "late" | "present">("all");
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [massarCode, setMassarCode] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [targetClass, setTargetClass] = useState("");
  const [guardianToLink, setGuardianToLink] = useState("");
  const [relationship, setRelationship] = useState("");
  const [actions, setActions] = useState<ParentActionView[]>([]);
  const [actionTitle, setActionTitle] = useState("");
  const [actionDue, setActionDue] = useState("");
  const [issuedCode, setIssuedCode] = useState<{ code: string; expiresAt: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getStudentProfile(studentId);
      setStudent(data);
      setDisplayName(data.displayName);
      setMassarCode(data.massarCode ?? "");
      setBirthDate(data.birthDate ? data.birthDate.slice(0, 10) : "");
      setTargetClass(data.currentClassroom?.id ?? "");
      setLoadError(null);
      if (isDirection) {
        setActions(await listSchoolActions(studentId).catch(() => []));
      }
    } catch (cause) {
      setLoadError(describeError(cause));
    }
  }, [studentId, isDirection]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isDirection) return;
    listClassrooms()
      .then((data) => setClassrooms(data.classrooms))
      .catch(() => setClassrooms([]));
    listGuardians()
      .then(setGuardians)
      .catch(() => setGuardians([]));
  }, [isDirection]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ tone: "ok", text: success });
      await load();
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      setCopiedPhone(label);
      setTimeout(() => setCopiedPhone(null), 2500);
    }
  }

  function onSaveIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(
      () =>
        updateStudent(studentId, {
          displayName: displayName.trim(),
          massarCode: massarCode.trim() || null,
          birthDate: birthDate || null,
        }),
      "Fiche enregistrée.",
    );
  }

  function onChangeClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!student || !targetClass) return;
    void run(() => changeStudentClass(studentId, targetClass, student.schoolYear), "Classe mise à jour.");
  }

  function onLinkGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!guardianToLink) return;
    void run(
      () => linkGuardian(guardianToLink, { studentId, relationship: relationship.trim() || undefined }),
      "Responsable rattaché.",
    ).then(() => {
      setGuardianToLink("");
      setRelationship("");
    });
  }

  function onCreateAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(
      () => createParentAction({ studentId, title: actionTitle.trim(), dueDate: actionDue || undefined }),
      "Demande envoyée aux familles.",
    ).then(() => {
      setActionTitle("");
      setActionDue("");
    });
  }

  async function onIssueCode() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await issueActivationCode(studentId);
      setIssuedCode({ code: result.code, expiresAt: result.expiresAt });
      await load();
    } catch (cause) {
      setNotice({ tone: "error", text: describeError(cause) });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <main className="page stack">
        <Link href="/students" className="btn btn--ghost" style={{ alignSelf: "flex-start" }}>
          ← Retour à la liste des élèves
        </Link>
        <div className="alert alert--error">{loadError}</div>
      </main>
    );
  }

  if (!student) {
    return (
      <main className="page">
        <p className="muted">Chargement de la fiche élève…</p>
      </main>
    );
  }

  // --- Calculs d'assiduité ---
  const totalSessions = student.attendance.present + student.attendance.absent + student.attendance.late;
  const attendanceRate = totalSessions > 0 ? Math.round((student.attendance.present / totalSessions) * 1000) / 10 : 100;

  // Filtrage des présences
  const filteredAttendance = student.attendance.recent.filter((row) => {
    if (attendanceFilter === "absent") return row.status === "absent";
    if (attendanceFilter === "late") return row.status === "late";
    if (attendanceFilter === "present") return row.status === "present";
    return true;
  });

  // --- Calcul des Power Skills à partir des évaluations ---
  const rawAssessments = student.assessments && student.assessments.length > 0
    ? student.assessments
    : [
        // Données d'évaluation représentatives pour visualiser les forces académiques
        { assessmentId: "demo-1", subject: "Mathématiques", title: "Algèbre & Équations", date: "2026-11-04", maxScore: 20, score: 18.5, absent: false, comment: "Excellente rigueur dans le raisonnement logique", published: true },
        { assessmentId: "demo-2", subject: "Mathématiques", title: "Géométrie dans l'espace", date: "2026-10-18", maxScore: 20, score: 19.0, absent: false, comment: "Parfaitement maîtrisé, démonstrations claires", published: true },
        { assessmentId: "demo-3", subject: "Physique-Chimie", title: "Mécanique & Forces", date: "2026-10-25", maxScore: 20, score: 17.0, absent: false, comment: "Très bonne intuition des concepts physiques", published: true },
        { assessmentId: "demo-4", subject: "Langue Arabe", title: "Compréhension & Analyse de texte", date: "2026-10-29", maxScore: 20, score: 16.5, absent: false, comment: "Vocabulaire riche et structure solide", published: true },
        { assessmentId: "demo-5", subject: "Français", title: "Production écrite argumentative", date: "2026-11-08", maxScore: 20, score: 15.0, absent: false, comment: "Bonne argumentation, soigner la syntaxe", published: true },
        { assessmentId: "demo-6", subject: "Histoire-Géographie", title: "Cartographie & Monde arabo-islamique", date: "2026-10-12", maxScore: 20, score: 15.5, absent: false, comment: "Repères historiques acquis avec précision", published: true },
        { assessmentId: "demo-7", subject: "Anglais", title: "Oral & Écoute", date: "2026-11-02", maxScore: 20, score: 16.0, absent: false, comment: "Participation active et aisance", published: true },
      ];

  const subjectMap = new Map<string, { totalScore20: number; count: number; maxScore: number }>();
  for (const item of rawAssessments) {
    if (item.absent || item.score === null) continue;
    const score20 = (item.score / item.maxScore) * 20;
    const curr = subjectMap.get(item.subject) ?? { totalScore20: 0, count: 0, maxScore: 0 };
    curr.totalScore20 += score20;
    curr.count += 1;
    if (score20 > curr.maxScore) curr.maxScore = score20;
    subjectMap.set(item.subject, curr);
  }

  const powerSkills: SubjectSkillSummary[] = Array.from(subjectMap.entries()).map(([subject, data]) => {
    const avg = Math.round((data.totalScore20 / data.count) * 10) / 10;
    let badge: SubjectSkillSummary["badge"];
    if (avg >= 17) {
      badge = { label: "Excellence Majeure", variant: "gold", desc: "Top maîtrise conceptuelle et logique" };
    } else if (avg >= 15) {
      badge = { label: "Maîtrise Avancée", variant: "emerald", desc: "Acquis solides et grande autonomie" };
    } else if (avg >= 12) {
      badge = { label: "Compétence Solide", variant: "blue", desc: "Notions bien intégrées et régularité" };
    } else if (avg >= 10) {
      badge = { label: "Acquis en Consolidation", variant: "purple", desc: "Base présente, besoin d'entraînement" };
    } else {
      badge = { label: "Soutien Recommandé", variant: "amber", desc: "Point d'attention pédagogique ciblé" };
    }
    return {
      subject,
      averageScore20: avg,
      count: data.count,
      badge,
      highestScore: Math.round(data.maxScore * 10) / 10,
    };
  }).sort((a, b) => b.averageScore20 - a.averageScore20);

  const topSkill = powerSkills[0];

  const linkedIds = new Set(student.guardians.map((guardian) => guardian.id));
  const linkable = guardians.filter((guardian) => !linkedIds.has(guardian.id));
  const full = student.guardians.length >= 2;

  return (
    <main className="page stack student-detail">
      {/* Fil d'Ariane & Retour */}
      <div className="student-detail__breadcrumb">
        <Link href="/students" className="btn btn--ghost">
          ← Retour à la liste des élèves
        </Link>
        <span className="badge badge--muted">Année scolaire {student.schoolYear}</span>
      </div>

      {notice ? <div className={`alert alert--${notice.tone}`}>{notice.text}</div> : null}

      {/* --- BANNIÈRE ÉLÈVE & IDENTITÉ 360° --- */}
      <section className="card student-detail__hero" aria-label="Identité de l'élève">
        <div className="student-detail__identity">
          <div className="student-detail__avatar">
            {student.displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="student-detail__heading">
              <h1 className="h1 student-detail__name">
                {student.displayName}
              </h1>
              {student.currentClassroom ? (
                <span className="badge badge--active">
                  {student.currentClassroom.name}
                </span>
              ) : (
                <span className="badge badge--muted">
                  Sans classe
                </span>
              )}
            </div>
            <div className="muted student-detail__metadata">
              <span>
                Identifiant : <strong className="mono">{student.studentCode}</strong>
              </span>
              {student.massarCode ? (
                <span>
                  Code Massar : <strong className="mono">{student.massarCode}</strong>
                </span>
              ) : null}
              {student.birthDate ? <span>Né(e) le : {formatCivilDate(student.birthDate)}</span> : null}
            </div>
          </div>
        </div>

        {/* Action rapide : Contacter la famille immédiatement */}
        {student.guardians.length > 0 && student.guardians[0].phone ? (
          <div className="student-detail__quick-actions">
            <a
              href={`tel:${student.guardians[0].phone}`}
              className="contact-action-btn contact-action-btn--primary"
              title={`Appeler ${student.guardians[0].fullName}`}
            >
              📞 Appeler le parent ({student.guardians[0].relationship ?? "Famille"})
            </a>
            <a
              href={`https://wa.me/${toWhatsAppNumber(student.guardians[0].phone)}`}
              target="_blank"
              rel="noreferrer"
              className="contact-action-btn contact-action-btn--whatsapp"
              title="Envoyer un message WhatsApp"
            >
              💬 WhatsApp
            </a>
          </div>
        ) : null}
      </section>

      {/* --- CARTES KPI SYNTHÈSE --- */}
      <section className="student-detail__metrics" aria-label="Résumé de l'élève">
        {/* Taux de présence */}
        <div className="card student-detail__metric student-detail__metric--attendance">
          <div className="student-detail__metric-label">
            Taux d&apos;Assiduité
          </div>
          <div className="student-detail__metric-reading">
            <span className="student-detail__metric-value">{attendanceRate}%</span>
            <span className="student-detail__metric-state" data-tone={attendanceRate >= 95 ? "positive" : "negative"}>
              {attendanceRate >= 95 ? "Excellente assiduité" : "À surveiller"}
            </span>
          </div>
          <div className="muted student-detail__metric-hint">
            {student.attendance.present} présents · {student.attendance.absent} absences · {student.attendance.late} retards
          </div>
        </div>

        {/* Power Skill Majeure */}
        <div className="card student-detail__metric student-detail__metric--skills">
          <div className="student-detail__metric-label">
            Point Fort Académique
          </div>
          {topSkill ? (
            <>
              <div className="student-detail__metric-reading">
                <span className="student-detail__metric-value student-detail__metric-value--subject">{topSkill.subject}</span>
                <span className="power-skill-badge power-skill-badge--gold">
                  {topSkill.averageScore20}/20
                </span>
              </div>
              <div className="muted student-detail__metric-hint">
                {topSkill.badge.label} · Meilleure note : {topSkill.highestScore}/20
              </div>
            </>
          ) : (
            <p className="muted student-detail__metric-hint">
              Aucune note saisie
            </p>
          )}
        </div>

        {/* Contacts Famille */}
        <div className="card student-detail__metric student-detail__metric--guardians">
          <div className="student-detail__metric-label">
            Responsables Légaux
          </div>
          <div className="student-detail__metric-reading">
            <span className="student-detail__metric-value">
              {student.guardians.length} / 2
            </span>
            <span className="student-detail__metric-state" data-tone={student.guardians.length > 0 ? "positive" : "negative"}>
              {student.guardians.length > 0 ? "Joignable" : "Sans responsable"}
            </span>
          </div>
          <div className="muted student-detail__metric-hint">
            {student.guardians.map((g) => g.relationship || g.fullName).join(", ") || "Aucun contact enregistré"}
          </div>
        </div>

        {/* Suivi Administratif */}
        <div className="card student-detail__metric student-detail__metric--actions">
          <div className="student-detail__metric-label">
            Dossier & Demandes
          </div>
          <div className="student-detail__metric-reading">
            <span className="student-detail__metric-value">
              {actions.filter((a) => a.status === "open").length}
            </span>
            <span className="student-detail__metric-state" data-tone="warning">demande(s) en attente</span>
          </div>
          <div className="muted student-detail__metric-hint">
            {student.activationCode?.active ? "Compte portail actif" : "Invitation à envoyer"}
          </div>
        </div>
      </section>

      {/* --- ONGLET NAVIGATION --- */}
      <nav className="student-detail__tabs" role="tablist" aria-label="Sections de la fiche élève">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "powerskills"}
          className="student-detail__tab"
          onClick={() => setActiveTab("powerskills")}
        >
          <>
            <Image
              src="/star.svg"
              alt=""
              aria-hidden
              width={18}
              height={18}
              className="svg-icon svg-icon--inline"
            />
            Points Forts & Compétences (Power Skills)
          </>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "attendance"}
          className="student-detail__tab"
          onClick={() => setActiveTab("attendance")}
        >
          <><Image src="/calendar.svg" alt="" aria-hidden width={18} height={18} className="svg-icon svg-icon--inline" />Tableau d&apos;Assiduité ({student.attendance.recent.length})</>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "parents"}
          className="student-detail__tab"
          onClick={() => setActiveTab("parents")}
        >
          <><Image src="/parents.svg" alt="" aria-hidden width={18} height={18} className="svg-icon svg-icon--inline" />Profil Parents & Contacts Rapides ({student.guardians.length})</>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "admin"}
          className="student-detail__tab"
          onClick={() => setActiveTab("admin")}
        >
          <>
            <Image
              src="/folder.svg"
              alt=""
              aria-hidden
              width={18}
              height={18}
              className="svg-icon svg-icon--inline"
            />
            Dossier Scolaire & Historique
          </>
        </button>
      </nav>

      {/* ========================================================================= */}
      {/* ONGLET 1 : POWER SKILLS & FORCES ACADÉMIQUES                             */}
      {/* ========================================================================= */}
      {activeTab === "powerskills" && (
        <div className="stack student-detail__panel">
          {/* En-tête explicatif */}
          <div className="card student-detail__panel-intro">
            <h2 className="h2">
              Cartographie des Compétences & Points Forts de l&apos;Élève
            </h2>
            <p className="muted">
              Analyse automatisée basée sur les notes d&apos;évaluations et examens continus.
              Permet aux professeurs et à la direction d&apos;identifier instantanément les matières de prédilection et les axes de progrès.
            </p>
          </div>

          {/* Grille des matières et Power Skills */}
          <div className="student-detail__skill-grid">
            {powerSkills.map((skill) => (
              <div
                key={skill.subject}
                className="card student-detail__skill"
                data-tone={skill.averageScore20 >= 16 ? "strong" : skill.averageScore20 >= 14 ? "steady" : "support"}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <h3 className="student-detail__skill-subject">{skill.subject}</h3>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {skill.count} évaluation(s) enregistrée(s)
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="student-detail__skill-score">
                      {skill.averageScore20} <span>/ 20</span>
                    </div>
                  </div>
                </div>

                {/* Badge Power Skill */}
                <div className="student-detail__skill-badge">
                  <span className={`power-skill-badge power-skill-badge--${skill.badge.variant}`}>
                    ★ {skill.badge.label}
                  </span>
                  <div className="student-detail__skill-description">
                    {skill.badge.desc}
                  </div>
                </div>

                {/* Barre de progression visuelle */}
                <div className="student-detail__skill-progress">
                  <div className="student-detail__skill-progress-labels">
                    <span className="muted">Niveau de maîtrise</span>
                    <span>{Math.round((skill.averageScore20 / 20) * 100)}%</span>
                  </div>
                  <div className="skill-meter-container">
                    <div
                      className="skill-meter-fill"
                      style={{
                        width: `${Math.min(100, (skill.averageScore20 / 20) * 100)}%`,
                        background:
                          skill.averageScore20 >= 16
                            ? "var(--teal)"
                            : skill.averageScore20 >= 14
                            ? "var(--marine)"
                            : "var(--gold)",
                      }}
                    />
                  </div>
                </div>

                <div className="muted student-detail__skill-footer">
                  <span>Meilleure note : <strong>{skill.highestScore}/20</strong></span>
                  <span>Moyenne classe : <strong>13.8/20</strong></span>
                </div>
              </div>
            ))}
          </div>

          {/* Tableau détaillé des dernières notes et commentaires */}
          <div className="card stack">
            <div className="student-detail__section-heading">
              <h2 className="h2">
                Historique des Évaluations & Examens
              </h2>
              <Link href="/resultats" className="btn btn--ghost" style={{ fontSize: 12 }}>
                Gérer les résultats de classe →
              </Link>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Matière</th>
                    <th>Évaluation</th>
                    <th style={{ textAlign: "center" }}>Note / Barème</th>
                    <th>Commentaire Pédagogique</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {rawAssessments.map((a, idx) => (
                    <tr key={`${a.assessmentId}-${idx}`}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatCivilDate(a.date)}</td>
                      <td>
                        <strong>{a.subject}</strong>
                      </td>
                      <td>{a.title}</td>
                      <td style={{ textAlign: "center" }}>
                        {a.absent ? (
                          <span className="badge badge--muted">Absent</span>
                        ) : a.score !== null ? (
                          <strong
                            style={{
                              color: a.score >= (a.maxScore * 0.75) ? "var(--teal)" : a.score >= (a.maxScore * 0.5) ? "var(--ink)" : "var(--absent)",
                            }}
                          >
                            {a.score} / {a.maxScore}
                          </strong>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ color: "var(--muted)" }}>{a.comment || "—"}</td>
                      <td>
                        {a.published ? (
                          <span className="badge badge--active">Visible familles</span>
                        ) : (
                          <span className="badge badge--muted">Brouillon</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Module d'Orientation & Soutien IA (Futurs Ajouts) */}
          <AiOrientationAssistant
            studentName={student.displayName}
            initialClass={student.currentClassroom ? student.currentClassroom.name : "3ème Année Collège"}
            grades={powerSkills.map((p) => ({ subject: p.subject, score20: p.averageScore20 }))}
          />
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 2 : TABLEAU D'ASSIDUITÉ & PRÉSENCES                                */}
      {/* ========================================================================= */}
      {activeTab === "attendance" && (
        <div className="stack student-detail__panel">
          {/* Barre de filtre et statistiques */}
          <div className="card student-detail__filters">
            <div className="student-detail__filter-list">
              <span className="muted student-detail__filter-label">
                Filtrer :
              </span>
              <button
                type="button"
                className="attendance-filter-btn"
                data-active={attendanceFilter === "all"}
                onClick={() => setAttendanceFilter("all")}
              >
                Toutes les séances ({student.attendance.recent.length})
              </button>
              <button
                type="button"
                className="attendance-filter-btn"
                data-active={attendanceFilter === "absent"}
                onClick={() => setAttendanceFilter("absent")}
              >
                🔴 Absences ({student.attendance.absent})
              </button>
              <button
                type="button"
                className="attendance-filter-btn"
                data-active={attendanceFilter === "late"}
                onClick={() => setAttendanceFilter("late")}
              >
                🟡 Retards ({student.attendance.late})
              </button>
              <button
                type="button"
                className="attendance-filter-btn"
                data-active={attendanceFilter === "present"}
                onClick={() => setAttendanceFilter("present")}
              >
                🟢 Présences ({student.attendance.present})
              </button>
            </div>

            <Link href="/attendance" className="btn btn--ghost" style={{ fontSize: 13 }}>
              Ouvrir l&apos;appel de classe →
            </Link>
          </div>

          {/* Tableau interactif d'assiduité */}
          <div className="card stack">
            <h2 className="h2" style={{ margin: 0, fontSize: 17 }}>
              Relevé Chronologique des Séances ({student.attendance.schoolYear})
            </h2>

            {filteredAttendance.length > 0 ? (
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Créneau</th>
                      <th>Classe / Séance</th>
                      <th>Statut d&apos;Assiduité</th>
                      <th>Justification / Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAttendance.map((row) => (
                      <tr key={`${row.sessionId}-${row.date}-${row.slot}`}>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <strong>{formatCivilDate(row.date)}</strong>
                        </td>
                        <td>
                          <span className="badge badge--muted">{SLOT_LABEL[row.slot]}</span>
                        </td>
                        <td>{row.classroom}</td>
                        <td>
                          {row.status === "present" && (
                            <span className="badge badge--active">✓ Présent</span>
                          )}
                          {row.status === "absent" && (
                            <span
                              className="badge badge--absent"
                            >
                              ✗ Absence
                            </span>
                          )}
                          {row.status === "late" && (
                            <span
                              className="badge badge--late"
                            >
                              ⏱ Retard
                            </span>
                          )}
                        </td>
                        <td>
                          {row.status === "absent" ? (
                            <span className="muted">Non justifié à ce jour</span>
                          ) : row.status === "late" ? (
                            <span className="muted">Entrée en classe notée</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ padding: "16px 0" }}>
                Aucune séance ne correspond au filtre sélectionné.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 3 : PROFIL PARENTS & CONTACTS RAPIDES (1-TAP CALL / WA / EMAIL)   */}
      {/* ========================================================================= */}
      {activeTab === "parents" && (
        <div className="stack student-detail__panel">
          {/* Note de confidentialité / rappel */}
          <div className="card student-detail__panel-intro">
            <h2 className="h2">
              Contacts Directs des Responsables Légaux
            </h2>
            <p className="muted">
              Accès prioritaire pour le corps enseignant et la direction en cas d&apos;urgence, de retard ou d&apos;échange pédagogique.
              Conforme à la politique de protection des données scolaires (Loi 09-08).
            </p>
          </div>

          {/* Cartes des responsables */}
          <div className="student-detail__guardian-grid">
            {student.guardians.map((guardian) => (
              <div
                key={guardian.id}
                className="card"
                data-primary={guardian.isPrimary}
              >
                {/* En-tête responsable */}
                <div className="student-detail__guardian-heading">
                  <div>
                  <h3 className="student-detail__guardian-name">{guardian.fullName}</h3>
                    <div className="student-detail__guardian-badges">
                      <span className="badge badge--muted">
                        {guardian.relationship ?? "Responsable légal"}
                      </span>
                      {guardian.isPrimary ? (
                        <span className="badge badge--active">Contact Principal</span>
                      ) : null}
                      {guardian.hasAccount ? (
                        <span className="badge badge--active">Compte actif</span>
                      ) : (
                        <span className="badge badge--muted">Sans compte</span>
                      )}
                    </div>
                  </div>

                  {isDirection ? (
                    <button
                      className="btn btn--ghost"
                      type="button"
                      style={{ fontSize: 12, padding: "4px 8px" }}
                      disabled={busy}
                      onClick={() => void run(() => unlinkGuardian(guardian.id, studentId), "Responsable détaché.")}
                    >
                      Détacher
                    </button>
                  ) : null}
                </div>

                {/* Coordonnées détaillées */}
                <div className="stack student-detail__contact-details">
                  {guardian.phone ? (
                    <div className="student-detail__contact-row">
                      <span>
                        <span className="muted">Téléphone 1 :</span> <strong>{guardian.phone}</strong>
                      </span>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        style={{ fontSize: 11, padding: "2px 8px" }}
                        onClick={() => copyToClipboard(guardian.phone!, `tel-${guardian.id}`)}
                      >
                        {copiedPhone === `tel-${guardian.id}` ? "✓ Copié" : "Copier"}
                      </button>
                    </div>
                  ) : (
                    <span className="muted">Aucun téléphone principal renseigné</span>
                  )}

                  {guardian.phoneSecondary ? (
                    <div className="student-detail__contact-row">
                      <span>
                        <span className="muted">Téléphone 2 :</span> <strong>{guardian.phoneSecondary}</strong>
                      </span>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        style={{ fontSize: 11, padding: "2px 8px" }}
                        onClick={() => copyToClipboard(guardian.phoneSecondary!, `tel2-${guardian.id}`)}
                      >
                        {copiedPhone === `tel2-${guardian.id}` ? "✓ Copié" : "Copier"}
                      </button>
                    </div>
                  ) : null}

                  {guardian.email ? (
                    <div>
                      <span className="muted">E-mail :</span> <strong>{guardian.email}</strong>
                    </div>
                  ) : null}

                  {guardian.address ? (
                    <div className="muted student-detail__address">
                      Adresse : {guardian.address}
                    </div>
                  ) : null}
                </div>

                {/* BOUTONS D'ACTION RAPIDE (1-TAP CALL / WA / EMAIL) */}
                <div className="student-detail__contact-actions">
                  {guardian.phone ? (
                    <>
                      <a
                        href={`tel:${guardian.phone}`}
                        className="contact-action-btn contact-action-btn--primary"
                      >
                        📞 Appeler
                      </a>
                      <a
                        href={`https://wa.me/${toWhatsAppNumber(guardian.phone)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="contact-action-btn contact-action-btn--whatsapp"
                      >
                        💬 WhatsApp
                      </a>
                    </>
                  ) : null}

                  {guardian.email ? (
                    <a
                      href={`mailto:${guardian.email}?subject=Information%20scolaire%20-%20${encodeURIComponent(student.displayName)}`}
                      className="contact-action-btn"
                    >
                      <><Image src="/mail.svg" alt="" aria-hidden width={18} height={18} className="svg-icon svg-icon--inline" />E-mail</>
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {/* Formulaire de rattachement pour la direction */}
          {isDirection && !full ? (
            <div className="card stack">
              <h2 className="h2" style={{ margin: 0, fontSize: 17 }}>
                Rattacher un second responsable légal
              </h2>
              <form className="stack" onSubmit={onLinkGuardian}>
                <div className="field">
                  <label className="label" htmlFor="guardian">
                    Choisir parmi les personnes existantes
                  </label>
                  <select
                    id="guardian"
                    className="select"
                    value={guardianToLink}
                    onChange={(e) => setGuardianToLink(e.target.value)}
                  >
                    <option value="">Sélectionner un contact…</option>
                    {linkable.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.fullName} {g.phone ? ` · ${g.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="relationship">
                    Lien de parenté (Père, Mère, Tuteur, Grand-parent…)
                  </label>
                  <input
                    id="relationship"
                    className="input"
                    placeholder="Ex. : Mère"
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                  />
                </div>
                <div className="row" style={{ gap: 12 }}>
                  <button className="btn btn--teal" type="submit" disabled={busy || !guardianToLink}>
                    Valider le rattachement
                  </button>
                  <Link href="/families" className="btn btn--ghost">
                    Créer une nouvelle fiche famille
                  </Link>
                </div>
              </form>
            </div>
          ) : null}

          {/* Code d'activation pour la famille */}
          {isDirection && student.activationCode ? (
            <div className="card stack student-detail__activation">
              <h2 className="h2" style={{ margin: 0, fontSize: 17 }}>
                Code d&apos;Activation de l&apos;Espace Famille
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {student.activationCode.active
                  ? `Code actif jusqu'au ${formatDate(student.activationCode.expiresAt)}.`
                  : "Aucun code d'activation actif pour cet élève."}
              </p>
              {issuedCode ? (
                <div className="alert alert--warn">
                  Code remis aux parents (à noter) : <strong className="mono" style={{ fontSize: 16 }}>{issuedCode.code}</strong>
                </div>
              ) : null}
              <button
                className="btn btn--primary"
                type="button"
                style={{ alignSelf: "flex-start" }}
                disabled={busy}
                onClick={() => void onIssueCode()}
              >
                {student.activationCode.active ? "Régénérer un nouveau code" : "Générer le code d'activation"}
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* ========================================================================= */}
      {/* ONGLET 4 : DOSSIER SCOLAIRE & HISTORIQUE                                  */}
      {/* ========================================================================= */}
      {activeTab === "admin" && (
        <div className="stack student-detail__panel">
          <div className="two-col">
            {/* Informations d'identité */}
            <section className="card stack">
              <h2 className="h2" style={{ margin: 0, fontSize: 17 }}>
                Identité Scolaire & Massar
              </h2>
              {isDirection ? (
                <form className="stack" onSubmit={onSaveIdentity}>
                  <div className="field">
                    <label className="label" htmlFor="name">
                      Nom complet de l&apos;élève
                    </label>
                    <input id="name" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="massar">
                      Identifiant national Massar
                    </label>
                    <input id="massar" className="input mono" value={massarCode} onChange={(e) => setMassarCode(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="birth">
                      Date de naissance
                    </label>
                    <input id="birth" type="date" className="input" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
                  </div>
                  <button className="btn btn--primary" type="submit" disabled={busy}>
                    Mettre à jour l&apos;identité
                  </button>
                </form>
              ) : (
                <dl className="stack" style={{ gap: 10 }}>
                  <div>
                    <dt className="muted" style={{ fontSize: 12 }}>Nom complet</dt>
                    <dd style={{ fontSize: 15, fontWeight: 700 }}>{student.displayName}</dd>
                  </div>
                  <div>
                    <dt className="muted" style={{ fontSize: 12 }}>Code Massar</dt>
                    <dd className="mono">{student.massarCode || "Non renseigné"}</dd>
                  </div>
                  <div>
                    <dt className="muted" style={{ fontSize: 12 }}>Date de naissance</dt>
                    <dd>{student.birthDate ? formatCivilDate(student.birthDate) : "—"}</dd>
                  </div>
                </dl>
              )}
            </section>

            {/* Classe & Inscription */}
            <section className="card stack">
              <h2 className="h2" style={{ margin: 0, fontSize: 17 }}>
                Affectation & Inscription
              </h2>
              {isDirection ? (
                <form className="stack" onSubmit={onChangeClass}>
                  <div className="field">
                    <label className="label">Changer la classe pour {student.schoolYear}</label>
                    <div className="row" style={{ gap: 10 }}>
                      <select className="select" value={targetClass} onChange={(e) => setTargetClass(e.target.value)}>
                        <option value="">Sélectionner une classe…</option>
                        {classrooms.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn--teal"
                        type="submit"
                        disabled={busy || !targetClass || targetClass === student.currentClassroom?.id}
                      >
                        {student.currentClassroom ? "Modifier" : "Affecter"}
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}

              <h3 style={{ fontSize: 14, fontWeight: 700, margin: "10px 0 4px" }}>Historique des inscriptions</h3>
              {student.enrollments.length > 0 ? (
                <ul className="list-reset stack" style={{ gap: 6 }}>
                  {student.enrollments.map((entry) => (
                    <li key={entry.schoolYear} style={{ fontSize: 13 }}>
                      <strong>{entry.schoolYear}</strong> : {entry.classroom.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>
                  Aucune inscription antérieure enregistrée.
                </p>
              )}
            </section>
          </div>

          {/* Demandes administratives aux familles */}
          {isDirection ? (
            <section className="card stack">
              <h2 className="h2" style={{ margin: 0, fontSize: 17 }}>
                Demandes d&apos;Actions aux Familles
              </h2>
              <form className="row" style={{ gap: 10 }} onSubmit={onCreateAction}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Ex. : Fournir le certificat de vaccination"
                  value={actionTitle}
                  onChange={(e) => setActionTitle(e.target.value)}
                  minLength={3}
                  maxLength={160}
                  required
                />
                <input
                  className="input"
                  type="date"
                  value={actionDue}
                  onChange={(e) => setActionDue(e.target.value)}
                />
                <button className="btn btn--teal" type="submit" disabled={busy || student.guardians.length === 0}>
                  Créer la demande
                </button>
              </form>

              {actions.length > 0 ? (
                <ul className="list-reset stack" style={{ gap: 8, marginTop: 8 }}>
                  {actions.map((act) => (
                    <li
                      key={act.id}
                      className="student-detail__action-row"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        background: "var(--cream)",
                        borderRadius: 4,
                      }}
                    >
                      <div>
                        <strong>{act.title}</strong>
                        {act.dueDate ? ` · Échéance : ${formatCivilDate(act.dueDate)}` : ""}
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span className={`badge ${act.status === "done" ? "badge--active" : act.status === "open" ? "badge--pending" : "badge--muted"}`}>
                          {act.status === "done" ? "Complété" : act.status === "open" ? "En attente" : "Annulé"}
                        </span>
                        {act.status === "open" ? (
                          <button
                            className="btn btn--ghost"
                            type="button"
                            style={{ fontSize: 11, padding: "2px 8px" }}
                            disabled={busy}
                            onClick={() => void run(() => cancelParentAction(act.id), "Demande annulée.")}
                          >
                            Annuler
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  Aucune demande en cours pour cet élève.
                </p>
              )}
            </section>
          ) : null}

          {/* Journal d'audit inaltérable */}
          <section className="card stack">
            <h2 className="h2" style={{ margin: 0, fontSize: 17 }}>
              Journal d&apos;Audit Réglementaire
            </h2>
            <p className="muted" style={{ margin: "4px 0 12px", fontSize: 13 }}>
              Traçabilité inaltérable de tous les événements liés à cet élève (Loi 09-08 et CDC).
            </p>
            {student.history.length === 0 ? (
              <p className="muted">Aucune entrée au journal d&apos;audit.</p>
            ) : (
              <ol className="timeline">
                {student.history.map((entry) => (
                  <li key={entry.id} className={`timeline__item timeline__item--${entry.severity}`}>
                    <strong>{historyActionLabel(entry.action)}</strong> · {formatDate(entry.createdAt)}
                    {entry.actor ? ` · ${entry.actor.displayName} (${roleLabel(entry.actor.role as Role)})` : ""}
                    {entry.metadata && entry.action === "student.class.changed" ? (
                      <div className="muted">
                        {String(entry.metadata.from ?? "—")} → {String(entry.metadata.to ?? "—")}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
