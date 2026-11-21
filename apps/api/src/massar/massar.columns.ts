/**
 * Colonnes des exports « format ORYA compatible pour saisie Massar ».
 *
 * IMPORTANT : ORYA n'a aucune connexion officielle à Massar et ne prétend pas
 * reproduire un format officiel. Ces colonnes sont une HYPOTHÈSE de travail,
 * à vérifier avec une vraie école avant usage. Les libellés sont modifiables
 * sans toucher au code via la variable d'environnement MASSAR_COLUMN_LABELS
 * (JSON { "cle": "Libellé" }), et le format du code Massar via
 * MASSAR_CODE_PATTERN (expression régulière).
 */
export const MASSAR_COLUMNS_VERSION = "orya-massar-v1-hypothese";

export const DEFAULT_MASSAR_PATTERN = "^[A-Z][0-9]{9}$";

export const COLUMN_SETS = {
  students: ["massarCode", "studentCode", "displayName", "birthDate", "classroom", "level", "schoolYear"],
  enrollments: ["massarCode", "studentCode", "displayName", "schoolYear", "classroom", "level", "cycle", "enrolledAt"],
  absences: ["massarCode", "studentCode", "displayName", "classroom", "date", "slot", "type", "justified", "justificationReason"],
  absenceTotals: ["massarCode", "studentCode", "displayName", "classroom", "absences", "lates", "unjustifiedAbsences", "unjustifiedLates"],
  anomalies: ["severity", "code", "studentCode", "massarCode", "displayName", "detail"],
} as const;

export type ColumnSet = keyof typeof COLUMN_SETS;

const DEFAULT_LABELS: Record<string, string> = {
  massarCode: "Code Massar",
  studentCode: "Code élève ORYA",
  displayName: "Nom et prénom",
  birthDate: "Date de naissance",
  classroom: "Classe",
  level: "Niveau",
  cycle: "Cycle",
  schoolYear: "Année scolaire",
  enrolledAt: "Date d'inscription ORYA",
  date: "Date",
  slot: "Séance",
  type: "Type",
  justified: "Justifiée",
  justificationReason: "Motif",
  absences: "Absences",
  lates: "Retards",
  unjustifiedAbsences: "Absences non justifiées",
  unjustifiedLates: "Retards non justifiés",
  severity: "Gravité",
  code: "Anomalie",
  detail: "Détail",
};

export function columnLabels(set: ColumnSet, env: string | undefined = process.env.MASSAR_COLUMN_LABELS): string[] {
  let overrides: Record<string, unknown> = {};
  if (env) {
    try {
      const parsed = JSON.parse(env) as unknown;
      if (parsed && typeof parsed === "object") overrides = parsed as Record<string, unknown>;
    } catch {
      overrides = {};
    }
  }
  return COLUMN_SETS[set].map((key) => {
    const value = overrides[key];
    return typeof value === "string" && value.trim() ? value.trim().slice(0, 60) : (DEFAULT_LABELS[key] ?? key);
  });
}

export function massarPattern(env: string | undefined = process.env.MASSAR_CODE_PATTERN): RegExp {
  try {
    return new RegExp(env && env.trim() ? env : DEFAULT_MASSAR_PATTERN);
  } catch {
    return new RegExp(DEFAULT_MASSAR_PATTERN);
  }
}
