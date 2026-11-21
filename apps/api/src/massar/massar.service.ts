import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import { todayInMorocco } from "../dashboard/dashboard.service";
import { toCsv, toXlsx, type Table } from "../dashboard/export";
import { columnLabels, MASSAR_COLUMNS_VERSION, massarPattern, type ColumnSet } from "./massar.columns";
import type { MassarCheckDto, MassarExportDto, MassarReport } from "./massar.dto";

type Tx = Prisma.TransactionClient;

export type AnomalyCode =
  | "massar_missing"
  | "massar_format"
  | "massar_duplicate"
  | "birthdate_missing"
  | "birthdate_implausible"
  | "not_enrolled"
  | "name_incomplete"
  | "possible_duplicate_student";

export type Anomaly = {
  severity: "error" | "warning";
  code: AnomalyCode;
  studentId: string;
  studentCode: string;
  massarCode: string | null;
  displayName: string;
  detail: string;
};

const ANOMALY_LABEL: Record<AnomalyCode, string> = {
  massar_missing: "Code Massar manquant",
  massar_format: "Format du code Massar à vérifier",
  massar_duplicate: "Code Massar en double",
  birthdate_missing: "Date de naissance manquante",
  birthdate_implausible: "Date de naissance improbable",
  not_enrolled: "Élève sans classe pour l'année",
  name_incomplete: "Nom et prénom incomplets",
  possible_duplicate_student: "Doublon probable (même nom et date de naissance)",
};

const MAX_PERIOD_DAYS = 366;
const ROW_CAP = 50_000;

function civil(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
function day(value: Date | null | undefined): string {
  return value ? value.toISOString().slice(0, 10) : "";
}
function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Lot 8 : préparation des données pour la saisie Massar.
 * Aucune connexion officielle à Massar : exports « format ORYA compatible pour
 * saisie Massar », colonnes supposées et configurables (voir massar.columns.ts).
 */
@Injectable()
export class MassarService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  private schoolYear(query: MassarCheckDto): string {
    return query.schoolYear ?? schoolYearForDate(civil(todayInMorocco()));
  }

  private requireSchool(auth: AuthContext): string {
    if (!auth.schoolId) throw new ForbiddenException("Un établissement actif est requis.");
    return auth.schoolId;
  }

  private async students(tx: Tx, schoolYear: string) {
    return tx.student.findMany({
      orderBy: [{ displayName: "asc" }, { studentCode: "asc" }],
      take: ROW_CAP,
      select: {
        id: true,
        studentCode: true,
        massarCode: true,
        displayName: true,
        birthDate: true,
        enrollments: {
          where: { schoolYear },
          select: { createdAt: true, classroom: { select: { name: true, level: true, cycle: true } } },
        },
      },
    });
  }

  /** Contrôle des champs obligatoires et des identifiants. */
  analyze(students: Awaited<ReturnType<MassarService["students"]>>, schoolYear: string): Anomaly[] {
    const pattern = massarPattern();
    const anomalies: Anomaly[] = [];
    const push = (student: (typeof students)[number], severity: Anomaly["severity"], code: AnomalyCode, detail: string) =>
      anomalies.push({ severity, code, studentId: student.id, studentCode: student.studentCode, massarCode: student.massarCode, displayName: student.displayName, detail });

    const byMassar = new Map<string, typeof students>();
    const byIdentity = new Map<string, typeof students>();
    const startYear = Number(schoolYear.slice(0, 4));

    for (const student of students) {
      const code = student.massarCode?.trim() ?? "";
      if (!code) {
        push(student, "error", "massar_missing", ANOMALY_LABEL.massar_missing);
      } else {
        if (!pattern.test(code)) push(student, "warning", "massar_format", `${ANOMALY_LABEL.massar_format} (attendu : ${pattern.source})`);
        const key = code.toUpperCase();
        byMassar.set(key, [...(byMassar.get(key) ?? []), student]);
      }
      if (!student.birthDate) {
        push(student, "error", "birthdate_missing", ANOMALY_LABEL.birthdate_missing);
      } else {
        const age = startYear - student.birthDate.getUTCFullYear();
        if (age < 2 || age > 25) push(student, "warning", "birthdate_implausible", `${ANOMALY_LABEL.birthdate_implausible} (${day(student.birthDate)})`);
        const identity = `${normalizeName(student.displayName)}|${day(student.birthDate)}`;
        byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), student]);
      }
      if (student.enrollments.length === 0) push(student, "error", "not_enrolled", `${ANOMALY_LABEL.not_enrolled} ${schoolYear}`);
      if (normalizeName(student.displayName).split(" ").filter(Boolean).length < 2) push(student, "warning", "name_incomplete", ANOMALY_LABEL.name_incomplete);
    }
    for (const [code, group] of byMassar) {
      if (group.length > 1) {
        for (const student of group) push(student, "error", "massar_duplicate", `${ANOMALY_LABEL.massar_duplicate} : ${code} (${group.map((s) => s.studentCode).join(", ")})`);
      }
    }
    for (const group of byIdentity.values()) {
      if (group.length > 1) {
        for (const student of group) push(student, "warning", "possible_duplicate_student", `${ANOMALY_LABEL.possible_duplicate_student} : ${group.map((s) => s.studentCode).join(", ")}`);
      }
    }
    return anomalies.sort((a, b) => (a.severity === b.severity ? a.studentCode.localeCompare(b.studentCode) : a.severity === "error" ? -1 : 1));
  }

  async check(auth: AuthContext, query: MassarCheckDto) {
    this.requireSchool(auth);
    const schoolYear = this.schoolYear(query);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const students = await this.students(tx, schoolYear);
      const anomalies = this.analyze(students, schoolYear);
      const byCode = Object.fromEntries(Object.keys(ANOMALY_LABEL).map((code) => [code, 0])) as Record<AnomalyCode, number>;
      for (const anomaly of anomalies) byCode[anomaly.code] += 1;
      const blocking = new Set(anomalies.filter((a) => a.severity === "error").map((a) => a.studentId));
      return {
        disclaimer: "Format ORYA compatible pour saisie Massar — aucune connexion officielle à Massar ; colonnes à vérifier avec l'école.",
        schoolYear,
        massarPattern: massarPattern().source,
        columnsVersion: MASSAR_COLUMNS_VERSION,
        totals: {
          students: students.length,
          withMassar: students.filter((s) => s.massarCode).length,
          enrolled: students.filter((s) => s.enrollments.length > 0).length,
          ready: students.length - blocking.size,
          errors: anomalies.filter((a) => a.severity === "error").length,
          warnings: anomalies.filter((a) => a.severity === "warning").length,
        },
        labels: ANOMALY_LABEL,
        byCode,
        anomalies: anomalies.slice(0, 500),
      };
    });
  }

  private period(query: MassarExportDto) {
    if (!query.from || !query.to) throw new BadRequestException("Période (from, to) obligatoire pour ce rapport.");
    const from = civil(query.from);
    const to = civil(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException("Dates invalides.");
    if (to < from) throw new BadRequestException("La date de fin précède la date de début.");
    if ((to.getTime() - from.getTime()) / 86_400_000 + 1 > MAX_PERIOD_DAYS) throw new BadRequestException(`Période limitée à ${MAX_PERIOD_DAYS} jours.`);
    return { from, to };
  }

  private table(set: ColumnSet, title: string, rows: (string | number | null)[][]): Table {
    return { title, columns: columnLabels(set), rows };
  }

  private async build(tx: Tx, report: MassarReport, schoolYear: string, query: MassarExportDto) {
    const students = await this.students(tx, schoolYear);
    const anomalies = this.analyze(students, schoolYear);
    const classOf = (s: (typeof students)[number]) => s.enrollments[0]?.classroom;
    switch (report) {
      case "students":
        return { anomalies, table: this.table("students", `Eleves ${schoolYear}`, students.map((s) => [s.massarCode ?? "", s.studentCode, s.displayName, day(s.birthDate), classOf(s)?.name ?? "", classOf(s)?.level ?? "", schoolYear])) };
      case "enrollments":
        return {
          anomalies,
          table: this.table("enrollments", `Inscriptions ${schoolYear}`, students.filter((s) => s.enrollments.length).map((s) => [s.massarCode ?? "", s.studentCode, s.displayName, schoolYear, classOf(s)?.name ?? "", classOf(s)?.level ?? "", classOf(s)?.cycle ?? "", day(s.enrollments[0]?.createdAt)])),
        };
      case "anomalies":
        return {
          anomalies,
          table: this.table("anomalies", `Anomalies ${schoolYear}`, anomalies.map((a) => [a.severity === "error" ? "Bloquant" : "À vérifier", ANOMALY_LABEL[a.code], a.studentCode, a.massarCode ?? "", a.displayName, a.detail])),
        };
      case "absences":
      case "absence-totals": {
        const { from, to } = this.period(query);
        const rows = await tx.attendanceRow.findMany({
          where: { status: { in: ["absent", "late"] }, session: { date: { gte: from, lte: to } } },
          orderBy: [{ session: { date: "asc" } }],
          take: ROW_CAP,
          select: { status: true, studentId: true, session: { select: { date: true, slot: true, classroom: { select: { name: true } } } } },
        });
        const ids = [...new Set(rows.map((r) => r.studentId))];
        const accepted = ids.length
          ? await tx.absenceJustification.findMany({
              where: { status: "accepted", studentId: { in: ids }, fromDate: { lte: to }, toDate: { gte: from } },
              select: { studentId: true, fromDate: true, toDate: true, reason: true },
            })
          : [];
        const info = new Map(students.map((s) => [s.id, s]));
        const cover = (studentId: string, date: Date) => accepted.find((j) => j.studentId === studentId && j.fromDate <= date && date <= j.toDate);
        if (report === "absences") {
          return {
            anomalies,
            table: this.table("absences", `Absences ${day(from)} ${day(to)}`, rows.map((r) => {
              const s = info.get(r.studentId);
              const j = cover(r.studentId, r.session.date);
              return [s?.massarCode ?? "", s?.studentCode ?? "", s?.displayName ?? "", r.session.classroom.name, day(r.session.date), r.session.slot === "morning" ? "Matin" : "Après-midi", r.status === "absent" ? "Absence" : "Retard", j ? "Oui" : "Non", j?.reason ?? ""];
            })),
          };
        }
        const totals = new Map<string, { a: number; l: number; ua: number; ul: number; classroom: string }>();
        for (const r of rows) {
          const entry = totals.get(r.studentId) ?? { a: 0, l: 0, ua: 0, ul: 0, classroom: r.session.classroom.name };
          const justified = Boolean(cover(r.studentId, r.session.date));
          if (r.status === "absent") { entry.a += 1; if (!justified) entry.ua += 1; } else { entry.l += 1; if (!justified) entry.ul += 1; }
          totals.set(r.studentId, entry);
        }
        return {
          anomalies,
          table: this.table("absenceTotals", `Totaux ${day(from)} ${day(to)}`, [...totals.entries()].map(([id, t]) => {
            const s = info.get(id);
            return [s?.massarCode ?? "", s?.studentCode ?? "", s?.displayName ?? "", t.classroom, t.a, t.l, t.ua, t.ul];
          })),
        };
      }
    }
  }

  async export(auth: AuthContext, query: MassarExportDto, client: ClientInfo) {
    const schoolId = this.requireSchool(auth);
    const schoolYear = this.schoolYear(query);
    const context = toTenantContext(auth);
    const { table, anomalies } = await this.tenancy.run(context, (tx) => this.build(tx, query.report, schoolYear, query));
    const content = query.format === "csv" ? toCsv(table) : await toXlsx(table, NOTICE);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const periodPart = query.from && query.to && query.report.startsWith("absence") ? `-${query.from}-${query.to}` : "";
    const filename = `orya-compatible-massar-${query.report}-${schoolYear}${periodPart}.${query.format}`;
    const isPeriod = query.report.startsWith("absence");
    const record = await this.tenancy.run(context, (tx) =>
      tx.massarExport.create({
        data: {
          schoolId,
          report: query.report,
          format: query.format,
          schoolYear,
          fromDate: isPeriod && query.from ? civil(query.from) : null,
          toDate: isPeriod && query.to ? civil(query.to) : null,
          rowCount: table.rows.length,
          anomalyCount: anomalies.length,
          sha256,
          filename,
          columnsVersion: MASSAR_COLUMNS_VERSION,
          createdById: auth.userId,
        },
        select: { id: true },
      }),
    );
    await this.audit.scoped(context, {
      action: "massar.exported",
      entity: "MassarExport",
      entityId: record.id,
      metadata: { report: query.report, format: query.format, schoolYear, rows: table.rows.length, anomalies: anomalies.length, sha256 },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { content, filename, exportId: record.id };
  }

  async history(auth: AuthContext) {
    this.requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const exports = await tx.massarExport.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
      return {
        exports: exports.map((e) => ({
          id: e.id,
          report: e.report,
          format: e.format,
          schoolYear: e.schoolYear,
          from: e.fromDate ? day(e.fromDate) : null,
          to: e.toDate ? day(e.toDate) : null,
          rowCount: e.rowCount,
          anomalyCount: e.anomalyCount,
          sha256: e.sha256,
          filename: e.filename,
          columnsVersion: e.columnsVersion,
          createdById: e.createdById,
          createdAt: e.createdAt,
        })),
      };
    });
  }
}

export const NOTICE = [
  "Format ORYA compatible pour saisie Massar.",
  "ORYA n'est pas connecté à Massar et ne reproduit aucun format officiel.",
  `Colonnes supposées (${MASSAR_COLUMNS_VERSION}), configurables, à vérifier avec l'établissement avant toute saisie.`,
];
