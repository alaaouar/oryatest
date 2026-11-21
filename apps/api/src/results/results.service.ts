import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { parseCivilDate, schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import { ownChild } from "../parent-space/common";
import { NotificationsService } from "../parent-space/notifications.service";
import type { CreateAssessmentDto, SetScoresDto } from "./results.dto";
import { DEFAULT_MAX_SCORE, validScore } from "./results-rules";

type Tx = Prisma.TransactionClient;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) throw new ForbiddenException("Un établissement actif est requis.");
  return auth.schoolId;
}

const ASSESSMENT_SELECT = {
  id: true,
  classroomId: true,
  schoolYear: true,
  subject: true,
  title: true,
  date: true,
  maxScore: true,
  publishedAt: true,
  createdAt: true,
  classroom: { select: { name: true } },
  _count: { select: { results: true } },
} as const;

type AssessmentRow = Prisma.AssessmentGetPayload<{ select: typeof ASSESSMENT_SELECT }>;

function view(a: AssessmentRow) {
  return {
    id: a.id,
    classroomId: a.classroomId,
    classroom: a.classroom.name,
    schoolYear: a.schoolYear,
    subject: a.subject,
    title: a.title,
    date: iso(a.date),
    maxScore: a.maxScore,
    publishedAt: a.publishedAt,
    resultCount: a._count.results,
  };
}

/**
 * t92 (CDC M7) : résultats saisis par l'enseignant affecté à la classe (ou la direction),
 * publiés ensuite aux familles (notification in-app) et à l'élève (compte actif).
 * Avant publication : invisibles côté parent et élève.
 */
@Injectable()
export class ResultsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Classe existante (RLS : école courante) ; enseignant : affecté pour l'année. */
  private async assertClassroom(tx: Tx, auth: AuthContext, classroomId: string, schoolYear: string) {
    const classroom = await tx.classroom.findFirst({ where: { id: classroomId }, select: { id: true } });
    if (!classroom) throw new NotFoundException("Classe introuvable.");
    if (auth.role === "direction") return;
    if (auth.role !== "teacher") throw new ForbiddenException("Rôle non autorisé.");
    const assignment = await tx.teacherClassroomAssignment.findFirst({
      where: { teacherProfileId: auth.profileId, classroomId, schoolYear },
      select: { id: true },
    });
    if (!assignment) throw new ForbiddenException("Vous n'êtes pas affecté à cette classe pour cette année scolaire.");
  }

  private async loadAssessment(tx: Tx, auth: AuthContext, id: string) {
    const assessment = await tx.assessment.findFirst({ where: { id }, select: ASSESSMENT_SELECT });
    if (!assessment) throw new NotFoundException("Évaluation introuvable.");
    await this.assertClassroom(tx, auth, assessment.classroomId, assessment.schoolYear);
    return assessment;
  }

  async list(auth: AuthContext, classroomId?: string) {
    requireSchool(auth);
    const schoolYear = schoolYearForDate(new Date());
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      let classroomFilter: Prisma.AssessmentWhereInput = {};
      if (auth.role === "teacher") {
        const own = await tx.teacherClassroomAssignment.findMany({
          where: { teacherProfileId: auth.profileId, schoolYear },
          select: { classroomId: true },
        });
        const ids = own.map((a) => a.classroomId);
        classroomFilter = { classroomId: { in: classroomId ? ids.filter((id) => id === classroomId) : ids } };
      } else if (classroomId) {
        classroomFilter = { classroomId };
      }
      const rows = await tx.assessment.findMany({
        where: { schoolYear, ...classroomFilter },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 200,
        select: ASSESSMENT_SELECT,
      });
      return { schoolYear, assessments: rows.map(view) };
    });
  }

  async create(auth: AuthContext, dto: CreateAssessmentDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    let date: Date;
    try {
      date = parseCivilDate(dto.date);
    } catch {
      throw new BadRequestException("Date invalide (attendu AAAA-MM-JJ).");
    }
    const schoolYear = schoolYearForDate(date);
    const context = toTenantContext(auth);
    const created = await this.tenancy.run(context, async (tx) => {
      await this.assertClassroom(tx, auth, dto.classroomId, schoolYear);
      return tx.assessment.create({
        data: {
          schoolId,
          classroomId: dto.classroomId,
          schoolYear,
          subject: dto.subject.trim(),
          title: dto.title.trim(),
          date,
          maxScore: dto.maxScore ?? DEFAULT_MAX_SCORE,
          createdById: auth.userId,
        },
        select: ASSESSMENT_SELECT,
      });
    });
    await this.audit.scoped(context, {
      action: "results.assessment.created",
      entity: "Assessment",
      entityId: created.id,
      severity: "info",
      metadata: { classroomId: created.classroomId, maxScore: created.maxScore },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return view(created);
  }

  async get(auth: AuthContext, id: string) {
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const assessment = await this.loadAssessment(tx, auth, id);
      const [enrollments, results] = await Promise.all([
        tx.enrollment.findMany({
          where: { classroomId: assessment.classroomId, schoolYear: assessment.schoolYear },
          orderBy: { student: { displayName: "asc" } },
          select: { student: { select: { id: true, displayName: true, studentCode: true } } },
        }),
        tx.assessmentResult.findMany({
          where: { assessmentId: assessment.id },
          select: { studentId: true, score: true, absent: true, comment: true },
        }),
      ]);
      const byStudent = new Map(results.map((r) => [r.studentId, r]));
      return {
        ...view(assessment),
        students: enrollments.map(({ student }) => {
          const r = byStudent.get(student.id);
          return {
            studentId: student.id,
            displayName: student.displayName,
            studentCode: student.studentCode,
            score: r?.score ?? null,
            absent: r?.absent ?? false,
            comment: r?.comment ?? null,
          };
        }),
      };
    });
  }

  async setScores(auth: AuthContext, id: string, dto: SetScoresDto, client: ClientInfo) {
    requireSchool(auth);
    const context = toTenantContext(auth);
    const outcome = await this.tenancy.run(context, async (tx) => {
      const assessment = await this.loadAssessment(tx, auth, id);
      const ids = [...new Set(dto.scores.map((s) => s.studentId))];
      if (ids.length !== dto.scores.length) throw new BadRequestException("Un élève apparaît deux fois.");
      const enrolled = await tx.enrollment.findMany({
        where: { classroomId: assessment.classroomId, schoolYear: assessment.schoolYear, studentId: { in: ids } },
        select: { studentId: true },
      });
      if (enrolled.length !== ids.length) throw new BadRequestException("Élève hors de la classe de l'évaluation.");
      for (const s of dto.scores) {
        const score = s.absent ? null : (s.score ?? null);
        if (!validScore(score, assessment.maxScore)) {
          throw new BadRequestException(`Note attendue entre 0 et ${assessment.maxScore} (2 décimales au plus).`);
        }
      }
      for (const s of dto.scores) {
        const absent = s.absent === true;
        const data = {
          score: absent ? null : (s.score ?? null),
          absent,
          comment: s.comment?.trim() || null,
          updatedById: auth.userId,
        };
        await tx.assessmentResult.upsert({
          where: { assessmentId_studentId: { assessmentId: assessment.id, studentId: s.studentId } },
          create: { schoolId: auth.schoolId!, assessmentId: assessment.id, studentId: s.studentId, ...data },
          update: data,
        });
      }
      return { count: dto.scores.length, published: !!assessment.publishedAt };
    });
    await this.audit.scoped(context, {
      action: "results.scores.updated",
      entity: "Assessment",
      entityId: id,
      severity: outcome.published ? "warning" : "info",
      metadata: outcome,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return this.get(auth, id);
  }

  async publish(auth: AuthContext, id: string, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const notified = await this.tenancy.run(context, async (tx) => {
      const assessment = await this.loadAssessment(tx, auth, id);
      if (assessment.publishedAt) throw new ConflictException("Évaluation déjà publiée.");
      if (assessment._count.results === 0) throw new BadRequestException("Aucun résultat saisi.");
      await tx.assessment.update({ where: { id: assessment.id }, data: { publishedAt: new Date(), publishedById: auth.userId } });
      const rows = await tx.assessmentResult.findMany({
        where: { assessmentId: assessment.id },
        select: {
          studentId: true,
          student: {
            select: {
              displayName: true,
              guardians: { where: { guardian: { userId: { not: null } } }, select: { guardian: { select: { userId: true } } } },
            },
          },
        },
      });
      let count = 0;
      for (const row of rows) {
        const userIds = row.student.guardians.map((g) => g.guardian.userId).filter((u): u is string => !!u);
        count += await this.notifications.notifyUsers(tx, schoolId, userIds, {
          kind: "results.published",
          title: `${row.student.displayName} : résultat disponible (${assessment.subject} - ${assessment.title})`,
          body: "Consultez le résultat dans votre espace.",
          link: `/family?resultat=${assessment.id}&eleve=${row.studentId}`,
        });
      }
      return count;
    });
    await this.audit.scoped(context, {
      action: "results.assessment.published",
      entity: "Assessment",
      entityId: id,
      severity: "info",
      metadata: { familiesNotified: notified },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { ok: true, familiesNotified: notified };
  }

  async delete(auth: AuthContext, id: string, client: ClientInfo) {
    requireSchool(auth);
    const context = toTenantContext(auth);
    await this.tenancy.run(context, async (tx) => {
      const assessment = await this.loadAssessment(tx, auth, id);
      if (assessment.publishedAt) {
        throw new ConflictException("Impossible de supprimer une évaluation déjà publiée aux familles.");
      }
      await tx.assessmentResult.deleteMany({ where: { assessmentId: id } });
      await tx.assessment.delete({ where: { id } });
    });
    await this.audit.scoped(context, {
      action: "results.assessment.deleted",
      entity: "Assessment",
      entityId: id,
      severity: "warning",
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { ok: true };
  }

  /** Parent : résultats PUBLIÉS d'un enfant rattaché au compte (404 sinon). */
  async forParent(auth: AuthContext, studentId: string) {
    requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, ...ownChild(auth) }, select: { id: true } });
      if (!student) throw new NotFoundException("Élève introuvable.");
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
          date: iso(r.assessment.date),
          maxScore: r.assessment.maxScore,
          score: r.score,
          absent: r.absent,
          comment: r.comment,
        })),
      };
    });
  }
}
