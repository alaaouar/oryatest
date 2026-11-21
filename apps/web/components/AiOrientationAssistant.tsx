"use client";

import { useMemo, useState } from "react";

export interface StudentSkillInput {
  subject: string;
  score20: number;
}

export interface AiOrientationAssistantProps {
  studentName?: string;
  initialClass?: string;
  grades?: StudentSkillInput[];
  compact?: boolean;
}

type CareerGoal = "engineering" | "medicine" | "business" | "architecture" | "humanities";

const CAREER_GOALS: { id: CareerGoal; label: string; icon: string; desc: string; keySubjects: string[] }[] = [
  {
    id: "engineering",
    label: "Ingénierie & Technologies (Grandes Écoles)",
    icon: "🔬",
    desc: "CPGE (MPSI/PCSI), ENSA, ENSAM, EHTP, EMI, Informatique, IA & Systèmes embarqués.",
    keySubjects: ["Mathématiques", "Physique-Chimie"],
  },
  {
    id: "medicine",
    label: "Médecine, Pharmacie & Santé",
    icon: "🩺",
    desc: "Facultés de Médecine et de Pharmacie (FMP/FMD), Médecine Dentaire, Vétérinaire (IAV).",
    keySubjects: ["Physique-Chimie", "SVT / Biologie", "Mathématiques"],
  },
  {
    id: "business",
    label: "Management, Finance & Entrepreneuriat",
    icon: "💼",
    desc: "ENCG, ISCAE, CPGE Économiques (ECT/ECS), Audit, Droit des affaires, Gestion internationale.",
    keySubjects: ["Mathématiques", "Français", "Anglais", "Histoire-Géo"],
  },
  {
    id: "architecture",
    label: "Architecture, Urbanisme & Design",
    icon: "🏛️",
    desc: "École Nationale d'Architecture (ENA), Génie civil, Topographie, Design d'espace.",
    keySubjects: ["Mathématiques", "Physique-Chimie", "Français"],
  },
  {
    id: "humanities",
    label: "Droit, Sciences Politiques & Médias",
    icon: "⚖️",
    desc: "Sciences Po, Facultés de Droit, ISIC Journalisme, Traduction, Diplomatie & Enseignement.",
    keySubjects: ["Langue Arabe", "Français", "Philosophie / Histoire-Géo"],
  },
];

export function AiOrientationAssistant({
  studentName = "Mehdi Benjelloun",
  initialClass = "3ème Année Collège A",
  grades,
  compact = false,
}: AiOrientationAssistantProps) {
  const [selectedGoal, setSelectedGoal] = useState<CareerGoal>("engineering");
  const [customClass, setCustomClass] = useState(initialClass);

  // Notes de base si non fournies
  const currentGrades = useMemo<StudentSkillInput[]>(() => {
    if (grades && grades.length > 0) return grades;
    return [
      { subject: "Mathématiques", score20: 18.5 },
      { subject: "Physique-Chimie", score20: 17.0 },
      { subject: "Langue Arabe", score20: 16.5 },
      { subject: "Français", score20: 15.0 },
      { subject: "Anglais", score20: 16.0 },
      { subject: "Histoire-Géo", score20: 14.5 },
      { subject: "SVT / Biologie", score20: 16.0 },
    ];
  }, [grades]);

  // Calcul du score moyen dans les matières clés pour le débouché choisi
  const analysis = useMemo(() => {
    const goalMeta = CAREER_GOALS.find((g) => g.id === selectedGoal)!;
    const gradeMap = new Map(currentGrades.map((g) => [g.subject, g.score20]));

    let totalWeighted = 0;
    let count = 0;
    for (const sub of goalMeta.keySubjects) {
      const score = gradeMap.get(sub) ?? 14;
      totalWeighted += score;
      count++;
    }

    const keyAverage = count > 0 ? totalWeighted / count : 14;
    const matchPercentage = Math.min(99, Math.max(50, Math.round((keyAverage / 20) * 105)));

    // Filière de lycée recommandée selon le profil
    let recommendedStream = "";
    let streamDetails = "";
    if (selectedGoal === "engineering") {
      recommendedStream = keyAverage >= 16 ? "Tronc Commun Scientifique → 1ère & 2ème Bac Sciences Mathématiques (A ou B)" : "Tronc Commun Scientifique → Bac Sciences Expérimentales (Option PC)";
      streamDetails = "Filière royale pour les concours d'ingénieurs (CPGE, ENSA, ENSAM). Vos résultats en mathématiques et physique démontrent une excellente capacité d'abstraction.";
    } else if (selectedGoal === "medicine") {
      recommendedStream = "Tronc Commun Scientifique → Bac Sciences Expérimentales (Option SVT ou PC)";
      streamDetails = "Orientation idéale pour le concours commun d'accès aux Facultés de Médecine et de Pharmacie (FMP). Accent indispensable sur la rigueur scientifique et la régularité.";
    } else if (selectedGoal === "business") {
      recommendedStream = "Tronc Commun Économique ou Scientifique → Bac Sciences Économiques ou Bac Sciences Maths";
      streamDetails = "Filière parfaitement calibrée pour les classes préparatoires économiques (ECT) et l'accès direct aux ENCG et à l'ISCAE.";
    } else if (selectedGoal === "architecture") {
      recommendedStream = "Tronc Commun Scientifique → Bac Sciences Mathématiques ou Sciences Physiques";
      streamDetails = "Combine la rigueur géométrique des mathématiques avec une sensibilité spatiale et d'expression écrite nécessaire au concours de l'ENA.";
    } else {
      recommendedStream = "Tronc Commun Lettres & Sciences Humaines → Bac Lettres ou Sciences Humaines";
      streamDetails = "Valorise la maîtrise linguistique bilingue (Arabe & Français) et l'analyse critique des textes pour les carrières juridiques et de communication.";
    }

    return {
      keyAverage: Math.round(keyAverage * 10) / 10,
      matchPercentage,
      recommendedStream,
      streamDetails,
      goalMeta,
    };
  }, [selectedGoal, currentGrades]);

  return (
    <div
      className="card"
      style={{
        background: "#ffffff",
        border: "1px solid var(--line, #d1d7dc)",
        borderRadius: 8,
        padding: compact ? "20px" : "28px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {/* En-tête : Badge futur ajout / Roadmap */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              background: "#f3e8ff",
              color: "#6b21a8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            🧭
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
              Conseiller d&apos;Orientation & Soutien Scolaire par IA
            </h3>
            <div className="muted" style={{ fontSize: 12 }}>
              Analyse prédictive des points forts académiques · Filières marocaines & Post-Bac
            </div>
          </div>
        </div>

        <span
          className="badge"
          style={{
            background: "#ede9fe",
            color: "#5b21b6",
            border: "1px solid #ddd6fe",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          🚀 En avant-première · Feuille de Route
        </span>
      </div>

      {/* Sélecteur de projet d'avenir */}
      <div>
        <label className="label" style={{ fontSize: 13, marginBottom: 8, display: "block" }}>
          Objectif de carrière ou d&apos;études supérieures envisagé :
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CAREER_GOALS.map((goal) => (
            <button
              key={goal.id}
              type="button"
              className="btn"
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 4,
                border: "1px solid",
                borderColor: selectedGoal === goal.id ? "var(--purple-deep, #5022c3)" : "var(--line, #d1d7dc)",
                background: selectedGoal === goal.id ? "#f3e8ff" : "#ffffff",
                color: selectedGoal === goal.id ? "#5b21b6" : "#1c1d1f",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
              onClick={() => setSelectedGoal(goal.id)}
            >
              <span>{goal.icon}</span>
              <span>{goal.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Résultat de l'analyse d'orientation IA */}
      <div
        style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
          <div>
            <span className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
              Filière recommandée pour {studentName} ({customClass}) :
            </span>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--marine, #153e7e)", marginTop: 4 }}>
              {analysis.recommendedStream}
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#4b5563", maxWidth: 650 }}>
              {analysis.streamDetails}
            </p>
          </div>

          <div
            style={{
              textAlign: "center",
              background: "#ffffff",
              padding: "12px 18px",
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              minWidth: 120,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6a6f73" }}>Indice d&apos;Adéquation</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#16a34a", lineHeight: 1.1, marginTop: 4 }}>
              {analysis.matchPercentage}%
            </div>
            <div style={{ fontSize: 11, color: "#16a34a", fontWeight: 600 }}>Très forte compatibilité</div>
          </div>
        </div>

        {/* Détail des matières déterminantes */}
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: "#1c1d1f" }}>
            Moyennes actuelles de l&apos;élève dans les matières clés pour cette voie :
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {analysis.goalMeta.keySubjects.map((sub) => {
              const item = currentGrades.find((g) => g.subject === sub);
              const score = item ? item.score20 : 14;
              return (
                <div
                  key={sub}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #d1d7dc",
                    padding: "6px 12px",
                    borderRadius: 4,
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{sub} :</span>
                  <span
                    style={{
                      fontWeight: 800,
                      color: score >= 16 ? "#16a34a" : score >= 14 ? "#2563eb" : "#d97706",
                    }}
                  >
                    {score} / 20
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Plan d'action et soutien personnalisé par IA */}
      <div className="card" style={{ padding: "18px 20px", background: "#fcfdfe", border: "1px solid #e0e7ff" }}>
        <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800, color: "#1e1b4b", display: "flex", alignItems: "center", gap: 8 }}>
          <span>💡</span> Plan de Soutien & Conseils Pédagogiques Personnalisés
        </h4>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, fontSize: 13 }}>
          <div style={{ background: "#ffffff", padding: "12px", borderRadius: 4, border: "1px solid #e5e7eb" }}>
            <strong style={{ color: "#153e7e", display: "block", marginBottom: 4 }}>
              🎯 Priorité académique immédiate
            </strong>
            <p style={{ margin: 0, color: "#4b5563", fontSize: 12 }}>
              Consolider la rédaction argumentée et les langues (Français & Arabe) pour maximiser les points au contrôle continu et à l&apos;examen régional.
            </p>
          </div>

          <div style={{ background: "#ffffff", padding: "12px", borderRadius: 4, border: "1px solid #e5e7eb" }}>
            <strong style={{ color: "#153e7e", display: "block", marginBottom: 4 }}>
              📚 Méthode de travail recommandée
            </strong>
            <p style={{ margin: 0, color: "#4b5563", fontSize: 12 }}>
              Consacrer 45 minutes hebdomadaires à la résolution d&apos;exercices de type olympiades / concours d&apos;ingénieurs pour approfondir la logique.
            </p>
          </div>

          <div style={{ background: "#ffffff", padding: "12px", borderRadius: 4, border: "1px solid #e5e7eb" }}>
            <strong style={{ color: "#153e7e", display: "block", marginBottom: 4 }}>
              🤝 Recommandation pour les parents
            </strong>
            <p style={{ margin: 0, color: "#4b5563", fontSize: 12 }}>
              Encourager l&apos;autonomie et planifier un entretien d&apos;orientation personnalisé avec le professeur principal au 2ème trimestre.
            </p>
          </div>
        </div>
      </div>

      {/* Garantie de souveraineté */}
      <div style={{ fontSize: 11, color: "#6b7280", display: "flex", alignItems: "center", gap: 6 }}>
        <span>🔒</span>
        <span>
          <strong>Garantie de souveraineté :</strong> Cet assistant d&apos;orientation fonctionne entièrement en local sur les données de l&apos;établissement, sans aucun transfert de données vers des régies publicitaires (Loi 09-08 & CNDP).
        </span>
      </div>
    </div>
  );
}
