import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import { schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import { busHistory } from "../bus/bus.service";
import { statusOnly } from "../parent-space/justifications.service";
import { StudentAccessService } from "./student-access.service";

type Tx = Prisma.TransactionClient;

/** Espace eleve : CONSULTATION SEULE (aucune ecriture), barriere consentement a chaque appel. */
@Injectable()
export class StudentSpaceService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly access: StudentAccessService,
  ) {}

  private gated<T>(auth: AuthContext, work: (tx: Tx, studentId: string) => Promise<T>): Promise<T> {
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const student = await this.access.resolve(tx, auth);
      return work(tx, student.id);
    });
  }

  private async classroomOf(tx: Tx, studentId: string) {
    const enrollment = await tx.enrollment.findFirst({
      where: { studentId, schoolYear: schoolYearForDate(new Date()) },
      select: { classroom: { select: { id: true, name: true } } },
    });
    return enrollment?.classroom ?? null;
  }

  me(auth: AuthContext) {
    return this.gated(auth, async (tx, studentId) => {
      const student = await tx.student.findFirst({ where: { id: studentId }, select: { displayName: true } });
      return {
        displayName: student?.displayName ?? "",
        classroom: await this.classroomOf(tx, studentId),
        schoolYear: schoolYearForDate(new Date()),
        readOnly: true,
      };
    });
  }

  agenda(auth: AuthContext) {
    return this.gated(auth, async (tx, studentId) => {
      const classroom = await this.classroomOf(tx, studentId);
      const from = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
      const to = new Date(from.getTime() + 60 * 86_400_000);
      const items = await tx.agendaItem.findMany({
        where: {
          date: { gte: from, lte: to },
          cancelledAt: null,
          OR: [{ classroomId: null }, ...(classroom ? [{ classroomId: classroom.id }] : [])],
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        take: 200,
        select: { id: true, kind: true, title: true, description: true, date: true, classroom: { select: { name: true } } },
      });
      return {
        items: items.map((i) => ({
          id: i.id,
          kind: i.kind,
          title: i.title,
          description: i.description,
          date: i.date.toISOString().slice(0, 10),
          classroom: i.classroom?.name ?? null,
        })),
      };
    });
  }

  attendance(auth: AuthContext) {
    return this.gated(auth, async (tx, studentId) => {
      const rows = await tx.attendanceRow.findMany({
        where: { studentId },
        orderBy: { recordedAt: "desc" },
        take: 200,
        select: { status: true, session: { select: { date: true, slot: true } } },
      });
      return {
        items: rows.map((r) => ({ date: r.session.date.toISOString().slice(0, 10), slot: r.session.slot, status: r.status })),
      };
    });
  }

  justifications(auth: AuthContext) {
    return this.gated(auth, async (tx, studentId) => ({ items: await statusOnly(tx, studentId) }));
  }

  bus(auth: AuthContext) {
    return this.gated(auth, (tx, studentId) => busHistory(tx, studentId));
  }

  /** t92 (CDC M7) : resultats PUBLIES de l'eleve (lecture seule, barriere consentement). */
  results(auth: AuthContext) {
    return this.gated(auth, async (tx, studentId) => {
      const rows = await tx.assessmentResult.findMany({
        where: { studentId, assessment: { publishedAt: { not: null } } },
        orderBy: { assessment: { date: "desc" } },
        take: 200,
        select: {
          score: true,
          absent: true,
          comment: true,
          assessment: { select: { id: true, subject: true, title: true, date: true, maxScore: true } },
        },
      });
      return {
        items: rows.map((r) => ({
          assessmentId: r.assessment.id,
          subject: r.assessment.subject,
          title: r.assessment.title,
          date: r.assessment.date.toISOString().slice(0, 10),
          maxScore: r.assessment.maxScore,
          score: r.score,
          absent: r.absent,
          comment: r.comment,
        })),
      };
    });
  }

  /** t92 (CDC M3) : notifications du compte eleve, lecture seule, barriere consentement. */
  notifications(auth: AuthContext) {
    return this.gated(auth, async (tx) => {
      const items = await tx.notification.findMany({
        where: { userId: auth.userId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, kind: true, title: true, body: true, createdAt: true },
      });
      return { items };
    });
  }
}
