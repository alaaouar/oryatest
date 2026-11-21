import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import { schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";

/**
 * Lecture parent. Le RLS limite à l'école ; le filtre applicatif limite aux
 * élèves liés à un responsable dont userId = compte connecté. Un enfant non
 * rattaché renvoie 404 (pas d'oracle d'existence).
 */
@Injectable()
export class FamilyService {
  constructor(private readonly tenancy: TenancyService) {}

  async children(auth: AuthContext) {
    const schoolYear = schoolYearForDate(new Date());
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const students = await tx.student.findMany({
        where: { guardians: { some: { guardian: { userId: auth.userId } } } },
        orderBy: { displayName: "asc" },
        select: {
          id: true,
          displayName: true,
          studentCode: true,
          enrollments: { where: { schoolYear }, select: { classroom: { select: { name: true } } } },
        },
      });
      const result = [];
      for (const student of students) {
        result.push({
          id: student.id,
          displayName: student.displayName,
          studentCode: student.studentCode,
          classroom: student.enrollments[0]?.classroom.name ?? null,
          attendance: await this.summary(tx, student.id, schoolYear),
        });
      }
      return result;
    });
  }

  async child(auth: AuthContext, studentId: string) {
    const schoolYear = schoolYearForDate(new Date());
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, guardians: { some: { guardian: { userId: auth.userId } } } },
        select: {
          id: true,
          displayName: true,
          studentCode: true,
          enrollments: { where: { schoolYear }, select: { classroom: { select: { name: true } } } },
        },
      });
      if (!student) throw new NotFoundException("Enfant introuvable.");

      const recent = await tx.attendanceRow.findMany({
        where: { studentId, session: { schoolYear } },
        orderBy: { session: { date: "desc" } },
        take: 30,
        select: { status: true, session: { select: { date: true, slot: true } } },
      });

      // Lot 4 : une absence ou un retard couvert par un justificatif accepté est « justifié ».
      const accepted = await tx.absenceJustification.findMany({
        where: { studentId, status: "accepted" },
        select: { fromDate: true, toDate: true },
      });
      const isJustified = (date: Date) =>
        accepted.some((entry) => entry.fromDate <= date && date <= entry.toDate);
      const rows = recent.map((row) => ({
        status: row.status,
        date: row.session.date,
        slot: row.session.slot,
        justified: row.status !== "present" && isJustified(row.session.date),
      }));
      const missed = rows.filter((row) => row.status !== "present");

      return {
        id: student.id,
        displayName: student.displayName,
        studentCode: student.studentCode,
        classroom: student.enrollments[0]?.classroom.name ?? null,
        schoolYear,
        attendance: await this.summary(tx, student.id, schoolYear),
        recentUnjustified: missed.filter((row) => !row.justified).length,
        recent: rows,
      };
    });
  }

  private async summary(
    tx: Parameters<Parameters<TenancyService["run"]>[1]>[0],
    studentId: string,
    schoolYear: string,
  ) {
    const grouped = await tx.attendanceRow.groupBy({
      by: ["status"],
      where: { studentId, session: { schoolYear } },
      _count: { _all: true },
    });
    const summary = { present: 0, absent: 0, late: 0 };
    for (const entry of grouped) summary[entry.status] = entry._count._all;
    return summary;
  }
}

function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) throw new ForbiddenException("Un établissement actif est requis.");
  return auth.schoolId;
}
