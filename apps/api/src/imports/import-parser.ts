import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";

export type ParsedStudentRow = {
  line: number;
  classroom: string;
  cycle?: string;
  level?: string;
  studentCode: string;
  massarCode?: string;
  displayName: string;
  birthDate?: string;
};

export type RowError = {
  line: number;
  column?: string;
  message: string;
};

export type ParseResult = {
  totalRows: number;
  rows: ParsedStudentRow[];
  errors: RowError[];
};

const MAX_COLUMNS = 40;

/** Préfixes interprétés comme formule par Excel / LibreOffice / Google Sheets. */
export const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const FORMULA_GUARDED_FIELDS: Array<[string, string]> = [
  ["classroom", "classe"],
  ["cycle", "cycle"],
  ["level", "niveau"],
  ["studentCode", "code élève"],
  ["massarCode", "code Massar"],
  ["displayName", "nom"],
];

/** Signature ZIP (PK\x03\x04) obligatoire pour un classeur .xlsx. */
function isZipSignature(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  );
}

/** Alias acceptés pour chaque colonne (normalisés : sans accent, minuscules). */
const COLUMN_ALIASES: Record<keyof Omit<ParsedStudentRow, "line">, string[]> = {
  classroom: ["classe", "class", "classroom", "clas"],
  cycle: ["cycle"],
  level: ["niveau", "level", "niveauscolaire"],
  studentCode: ["codeeleve", "code", "matricule", "identifiant", "studentcode"],
  massarCode: ["codemassar", "massar", "massarcode", "code_massar"],
  displayName: ["nom", "nomeleve", "eleve", "nomprenom", "name", "nomcomplet"],
  birthDate: ["datenaissance", "naissance", "birthdate", "datedenaissance"],
};

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildHeaderMap(header: string[]): Map<number, string> {
  const map = new Map<number, string>();

  header.forEach((raw, index) => {
    const key = normalizeKey(raw);

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if ((aliases as string[]).includes(key) && ![...map.values()].includes(field)) {
        map.set(index, field);
        return;
      }
    }
  });

  return map;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;

  return semicolons > commas ? ";" : ",";
}

function toMatrixCsv(buffer: Buffer): string[][] {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");

  if (text.includes("\u0000")) {
    throw new Error("fichier CSV invalide (caractères binaires)");
  }

  return parseCsv(text, {
    delimiter: detectDelimiter(text),
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as string[][];
}

async function toMatrixXlsx(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheet = workbook.worksheets[0];

  if (!sheet) {
    throw new Error("classeur sans feuille");
  }

  const matrix: string[][] = [];

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    const count = Math.min(row.cellCount, MAX_COLUMNS);

    for (let column = 1; column <= count; column += 1) {
      const cell = row.getCell(column);
      values.push(cellText(cell.value));
    }

    matrix.push(values);
  });

  return matrix;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "object" && "text" in value && typeof value.text === "string") {
    return value.text.trim();
  }
  if (typeof value === "object" && "result" in value) {
    return String(value.result ?? "").trim();
  }
  return "";
}

function parseDate(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const french = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (french) {
    const [, day, month, year] = french;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  throw new Error("date de naissance illisible (attendu AAAA-MM-JJ ou JJ/MM/AAAA)");
}

export function mapRows(matrix: string[][]): ParseResult {
  const errors: RowError[] = [];
  const rows: ParsedStudentRow[] = [];

  if (matrix.length === 0) {
    return { totalRows: 0, rows, errors: [{ line: 0, message: "fichier vide" }] };
  }

  const header = matrix[0] ?? [];
  const headerMap = buildHeaderMap(header);

  const required: Array<keyof Omit<ParsedStudentRow, "line">> = [
    "classroom",
    "studentCode",
    "displayName",
  ];

  const missing = required.filter((field) => ![...headerMap.values()].includes(field));
  if (missing.length > 0) {
    return {
      totalRows: matrix.length - 1,
      rows,
      errors: [
        {
          line: 1,
          message: `colonnes obligatoires absentes : ${missing.join(", ")}`,
        },
      ],
    };
  }

  const seenCodes = new Map<string, number>();

  for (let index = 1; index < matrix.length; index += 1) {
    const line = index + 1;
    const values = matrix[index] ?? [];
    const record: Record<string, string> = {};

    headerMap.forEach((field, column) => {
      record[field] = (values[column] ?? "").trim();
    });

    const rowErrors: RowError[] = [];

    if (!record.classroom) {
      rowErrors.push({ line, column: "classe", message: "classe manquante" });
    }
    if (!record.studentCode) {
      rowErrors.push({ line, column: "code élève", message: "code élève manquant" });
    }
    if (!record.displayName) {
      rowErrors.push({ line, column: "nom", message: "nom manquant" });
    }
    if (record.studentCode && record.studentCode.length > 40) {
      rowErrors.push({ line, column: "code élève", message: "code élève trop long (40 max)" });
    }
    if (record.displayName && record.displayName.length > 120) {
      rowErrors.push({ line, column: "nom", message: "nom trop long (120 max)" });
    }

    // Protection contre l'injection de formules (CSV/XLSX réexportés vers un
    // tableur) : une cellule texte ne peut pas commencer par = + - @ TAB CR.
    for (const [field, label] of FORMULA_GUARDED_FIELDS) {
      const value = record[field];
      if (value && FORMULA_PREFIX.test(value)) {
        rowErrors.push({
          line,
          column: label,
          message: "valeur refusée : elle commence par un caractère de formule (= + - @)",
        });
      }
    }

    if (record.studentCode) {
      const previous = seenCodes.get(record.studentCode);
      if (previous !== undefined) {
        rowErrors.push({
          line,
          column: "code élève",
          message: `doublon dans le fichier (déjà ligne ${previous})`,
        });
      } else {
        seenCodes.set(record.studentCode, line);
      }
    }

    let birthDate: string | undefined;
    try {
      birthDate = parseDate(record.birthDate ?? "");
    } catch (error) {
      rowErrors.push({
        line,
        column: "date de naissance",
        message: error instanceof Error ? error.message : "date invalide",
      });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    rows.push({
      line,
      classroom: record.classroom ?? "",
      cycle: record.cycle || undefined,
      level: record.level || undefined,
      studentCode: record.studentCode ?? "",
      massarCode: record.massarCode || undefined,
      displayName: record.displayName ?? "",
      birthDate,
    });
  }

  return { totalRows: matrix.length - 1, rows, errors };
}

export async function parseWorkbook(filename: string, buffer: Buffer): Promise<ParseResult> {
  const isXlsx = /\.xlsx$/i.test(filename);
  if (!isXlsx && !/\.csv$/i.test(filename)) {
    throw new Error("format non pris en charge (attendu .csv ou .xlsx)");
  }
  if (isXlsx && !isZipSignature(buffer)) {
    throw new Error("fichier .xlsx invalide (signature de classeur absente)");
  }
  const matrix = isXlsx ? await toMatrixXlsx(buffer) : toMatrixCsv(buffer);

  return mapRows(matrix);
}

// ---------------------------------------------------------------------------
// Lot 3 (2.1b) : import des responsables légaux
// ---------------------------------------------------------------------------

export type ParsedGuardianRow = {
  line: number;
  studentCode: string;
  fullName: string;
  email?: string;
  phone?: string;
  phoneSecondary?: string;
  relationship?: string;
  address?: string;
  isPrimary?: boolean;
};

export type GuardianParseResult = {
  totalRows: number;
  rows: ParsedGuardianRow[];
  errors: RowError[];
};

const GUARDIAN_ALIASES: Record<keyof Omit<ParsedGuardianRow, "line">, string[]> = {
  studentCode: ["codeeleve", "code", "matricule", "identifiant", "studentcode", "codeleve"],
  fullName: ["nomresponsable", "responsable", "nomparent", "parent", "nom", "nomcomplet", "fullname", "nomprenom"],
  email: ["email", "mail", "courriel", "adressemail", "emailresponsable"],
  phone: ["telephone", "tel", "gsm", "mobile", "phone", "portable"],
  phoneSecondary: ["telephone2", "tel2", "gsm2", "mobile2", "autretelephone"],
  relationship: ["lien", "lienparente", "relation", "qualite", "parente"],
  address: ["adresse", "address"],
  isPrimary: ["principal", "responsableprincipal", "primary"],
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 .\-]{7,19}$/;

export function mapGuardianRows(matrix: string[][]): GuardianParseResult {
  const errors: RowError[] = [];
  const rows: ParsedGuardianRow[] = [];

  if (matrix.length === 0) {
    return { totalRows: 0, rows, errors: [{ line: 0, message: "fichier vide" }] };
  }

  const header = matrix[0] ?? [];
  const map = new Map<number, string>();
  header.forEach((raw, index) => {
    const key = normalizeKey(raw);
    for (const [field, aliases] of Object.entries(GUARDIAN_ALIASES)) {
      if (aliases.includes(key) && ![...map.values()].includes(field)) {
        map.set(index, field);
        return;
      }
    }
  });

  const missing = (["studentCode", "fullName"] as const).filter((field) => ![...map.values()].includes(field));
  if (missing.length > 0) {
    return {
      totalRows: matrix.length - 1,
      rows,
      errors: [{ line: 1, message: `colonnes obligatoires absentes : ${missing.join(", ")}` }],
    };
  }

  const seen = new Map<string, number>();

  for (let index = 1; index < matrix.length; index += 1) {
    const line = index + 1;
    const values = matrix[index] ?? [];
    const record: Record<string, string> = {};
    map.forEach((field, column) => {
      record[field] = (values[column] ?? "").trim();
    });

    const rowErrors: RowError[] = [];
    if (!record.studentCode) rowErrors.push({ line, column: "code élève", message: "code élève manquant" });
    if (!record.fullName) rowErrors.push({ line, column: "responsable", message: "nom du responsable manquant" });
    if (record.fullName && record.fullName.length > 120) {
      rowErrors.push({ line, column: "responsable", message: "nom trop long (120 max)" });
    }
    if (record.email && !EMAIL_PATTERN.test(record.email)) {
      rowErrors.push({ line, column: "email", message: "adresse e-mail invalide" });
    }
    for (const [field, label] of [
      ["phone", "téléphone"],
      ["phoneSecondary", "téléphone 2"],
    ] as const) {
      if (record[field] && !PHONE_PATTERN.test(record[field])) {
        rowErrors.push({ line, column: label, message: "numéro de téléphone invalide" });
      }
    }
    for (const [field, label] of [
      ["studentCode", "code élève"],
      ["fullName", "responsable"],
      ["relationship", "lien"],
      ["address", "adresse"],
      ["email", "email"],
    ] as const) {
      if (record[field] && FORMULA_PREFIX.test(record[field])) {
        rowErrors.push({
          line,
          column: label,
          message: "valeur refusée : elle commence par un caractère de formule (= + - @)",
        });
      }
    }

    const identity = `${record.studentCode}|${(record.email || record.fullName || "").toLowerCase()}`;
    const previous = seen.get(identity);
    if (record.studentCode && previous !== undefined) {
      rowErrors.push({ line, message: `doublon dans le fichier (déjà ligne ${previous})` });
    } else if (record.studentCode) {
      seen.set(identity, line);
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    const primaryRaw = normalizeKey(record.isPrimary ?? "");
    rows.push({
      line,
      studentCode: record.studentCode ?? "",
      fullName: record.fullName ?? "",
      email: record.email ? record.email.toLowerCase() : undefined,
      phone: record.phone || undefined,
      phoneSecondary: record.phoneSecondary || undefined,
      relationship: record.relationship || undefined,
      address: record.address || undefined,
      isPrimary: primaryRaw ? ["oui", "yes", "1", "x", "vrai", "true"].includes(primaryRaw) : undefined,
    });
  }

  return { totalRows: matrix.length - 1, rows, errors };
}

export async function parseGuardianWorkbook(filename: string, buffer: Buffer): Promise<GuardianParseResult> {
  const isXlsx = /\.xlsx$/i.test(filename);
  if (!isXlsx && !/\.csv$/i.test(filename)) {
    throw new Error("format non pris en charge (attendu .csv ou .xlsx)");
  }
  if (isXlsx && !isZipSignature(buffer)) {
    throw new Error("fichier .xlsx invalide (signature de classeur absente)");
  }
  const matrix = isXlsx ? await toMatrixXlsx(buffer) : toMatrixCsv(buffer);
  return mapGuardianRows(matrix);
}
