import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { sha256 } from "../core/crypto";
import { formatActivationCode, generateActivationCode } from "../core/activation-code";
import { TenancyService } from "../core/tenancy.service";
import { AuditService } from "../audit/audit.service";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { schoolYearForDate } from "../core/school-year";
import type { ChangeClassDto, ListStudentsQueryDto, UpdateStudentDto } from "./students.dto";

const DEFAULT_TTL_DAYS = 30;
const MAX_TTL_DAYS = 365;

/**
 * Élèves (Lot 1 → Lot 3) : liste filtrable, fiche complète, mise à jour,
 * changement de classe, historique et codes d'activation parent.
 *
 * Le RLS restreint toutes les lignes à l'école du jeton : un élève d'une autre
 * école est invisible (404). Les coordonnées des responsables ne sont exposées
 * qu'à la direction.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, query: ListStudentsQueryDto = {}) {
    const schoolYear = query.schoolYear ?? schoolYearForDate(new Date());
    const search = query.search?.trim();
    const where: Prisma.StudentWhereInput = {};
    const and: Prisma.StudentWhereInput[] = [];
    if (search) {
      and.push({
        OR: [
          { displayName: { contains: search, mode: "insensitive" } },
          { studentCode: { contains: search, mode: "insensitive" } },
          { massarCode: { contains: search, mode: "insensitive" } },
        ],
      });
    }
    if (query.classroomId) {
      and.push({ enrollments: { some: { classroomId: query.classroomId, schoolYear } } });
    }
    if (query.unassigned === "true") {
      and.push({ enrollments: { none: { schoolYear } } });
    }
    if (and.length > 0) {
      where.AND = and;
    }

    const rows = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.student.findMany({
        where,
        orderBy: [{ displayName: "asc" }],
        take: 500,
        select: {
          id: true,
          studentCode: true,
          displayName: true,
          massarCode: true,
          birthDate: true,
          enrollments: {
            where: { schoolYear },
            select: { classroom: { select: { id: true, name: true } } },
          },
          _count: { select: { guardians: true } },
        },
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      studentCode: row.studentCode,
      displayName: row.displayName,
      massarCode: row.massarCode,
      birthDate: row.birthDate,
      classroom: row.enrollments[0]?.classroom ?? null,
      guardianCount: row._count.guardians,
    }));
  }

  /** Compatibilité Lot 1 : lecture simple utilisée par les tests d'isolation. */
  async get(auth: AuthContext, studentId: string) {
    const student = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.student.findFirst({
        where: { id: studentId },
        select: { id: true, studentCode: true, displayName: true, massarCode: true },
      }),
    );

    if (!student) {
      throw new NotFoundException("Élève introuvable.");
    }

    return student;
  }

  /** Fiche élève complète (Lot 3). */
  async detail(auth: AuthContext, studentId: string) {
    const canSeeContacts = auth.role === "direction" || auth.role === "teacher" || auth.role === "super_admin";
    const canManageActivation = auth.role === "direction" || auth.role === "super_admin";
    const schoolYear = schoolYearForDate(new Date());

    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId },
        select: {
          id: true,
          studentCode: true,
          massarCode: true,
          displayName: true,
          birthDate: true,
          activationCodeIssuedAt: true,
          activationCodeExpiresAt: true,
          createdAt: true,
          updatedAt: true,
          enrollments: {
            orderBy: { schoolYear: "desc" },
            select: {
              schoolYear: true,
              createdAt: true,
              classroom: { select: { id: true, name: true, cycle: true, level: true } },
            },
          },
          guardians: {
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            select: {
              relationship: true,
              isPrimary: true,
              guardian: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  phone: true,
                  phoneSecondary: true,
                  address: true,
                  userId: true,
                },
              },
            },
          },
        },
      });

      if (!student) {
        throw new NotFoundException("Élève introuvable.");
      }

      const grouped = await tx.attendanceRow.groupBy({
        by: ["status"],
        where: { studentId, session: { schoolYear } },
        _count: { _all: true },
      });
      const summary = { present: 0, absent: 0, late: 0 };
      for (const entry of grouped) {
        summary[entry.status] = entry._count._all;
      }

      const recent = await tx.attendanceRow.findMany({
        where: { studentId, session: { schoolYear } },
        orderBy: { session: { date: "desc" } },
        take: 50,
        select: {
          status: true,
          session: { select: { id: true, date: true, slot: true, classroom: { select: { name: true } } } },
        },
      });

      const assessmentResults = await tx.assessmentResult.findMany({
        where: { studentId },
        orderBy: { assessment: { date: "desc" } },
        take: 50,
        select: {
          score: true,
          absent: true,
          comment: true,
          assessment: {
            select: {
              id: true,
              subject: true,
              title: true,
              date: true,
              maxScore: true,
              publishedAt: true,
            },
          },
        },
      });

      const entries = await tx.auditLog.findMany({
        where: { entity: "Student", entityId: studentId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, action: true, severity: true, metadata: true, actorId: true, createdAt: true },
      });
      const actorIds = [...new Set(entries.map((entry) => entry.actorId).filter((id): id is string => !!id))];
      const actors = actorIds.length
        ? await tx.userProfile.findMany({
            where: { userId: { in: actorIds }, schoolId: auth.schoolId },
            select: { userId: true, displayName: true, role: true },
          })
        : [];
      const actorMap = new Map(actors.map((actor) => [actor.userId, actor]));

      return {
        id: student.id,
        studentCode: student.studentCode,
        massarCode: student.massarCode,
        displayName: student.displayName,
        birthDate: student.birthDate,
        createdAt: student.createdAt,
        updatedAt: student.updatedAt,
        schoolYear,
        currentClassroom: student.enrollments.find((entry) => entry.schoolYear === schoolYear)?.classroom ?? null,
        enrollments: student.enrollments,
        activationCode: canManageActivation
          ? {
              issuedAt: student.activationCodeIssuedAt,
              expiresAt: student.activationCodeExpiresAt,
              active:
                !!student.activationCodeExpiresAt && student.activationCodeExpiresAt.getTime() > Date.now(),
            }
          : null,
        assessments: assessmentResults.map((r) => ({
          assessmentId: r.assessment.id,
          subject: r.assessment.subject,
          title: r.assessment.title,
          date: r.assessment.date.toISOString(),
          maxScore: r.assessment.maxScore,
          score: r.score,
          absent: r.absent,
          comment: r.comment,
          published: r.assessment.publishedAt !== null,
        })),
        guardians: student.guardians.map((link) => ({
          id: link.guardian.id,
          fullName: link.guardian.fullName,
          relationship: link.relationship,
          isPrimary: link.isPrimary,
          hasAccount: !!link.guardian.userId,
          email: canSeeContacts ? link.guardian.email : null,
          phone: canSeeContacts ? link.guardian.phone : null,
          phoneSecondary: canSeeContacts ? link.guardian.phoneSecondary : null,
          address: canSeeContacts ? link.guardian.address : null,
        })),
        attendance: {
          schoolYear,
          ...summary,
          recent: recent.map((row) => ({
            status: row.status,
            sessionId: row.session.id,
            date: row.session.date,
            slot: row.session.slot,
            classroom: row.session.classroom.name,
          })),
        },
        history: entries.map((entry) => {
          const actor = entry.actorId ? actorMap.get(entry.actorId) : undefined;
          return {
            id: entry.id,
            action: entry.action,
            severity: entry.severity,
            createdAt: entry.createdAt,
            actor: actor ? { displayName: actor.displayName, role: actor.role } : null,
            metadata: canSeeContacts ? entry.metadata : null,
          };
        }),
      };
    });
  }

  async update(auth: AuthContext, studentId: string, dto: UpdateStudentDto, client: ClientInfo) {
    const context = toTenantContext(auth);
    requireSchool(auth);

    const data: Prisma.StudentUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName.trim();
    if (dto.birthDate !== undefined) {
      data.birthDate = dto.birthDate ? new Date(`${dto.birthDate}T00:00:00.000Z`) : null;
    }
    if (dto.massarCode !== undefined) data.massarCode = dto.massarCode ? dto.massarCode.trim() : null;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("Aucune modification fournie.");
    }

    const result = await this.tenancy.run(context, async (tx) => {
      const before = await tx.student.findFirst({
        where: { id: studentId },
        select: { displayName: true, massarCode: true, birthDate: true },
      });
      if (!before) {
        throw new NotFoundException("Élève introuvable.");
      }
      try {
        const after = await tx.student.update({
          where: { id: studentId },
          data,
          select: { id: true, displayName: true, massarCode: true, birthDate: true },
        });
        return { before, after };
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException("Ce code Massar est déjà attribué à un autre élève.");
        }
        throw error;
      }
    });

    const changed = Object.keys(data);
    await this.audit.scoped(context, {
      action: "student.updated",
      entity: "Student",
      entityId: studentId,
      severity: changed.includes("massarCode") ? "warning" : "info",
      metadata: {
        fields: changed,
        ...(changed.includes("massarCode")
          ? { massarFrom: result.before.massarCode, massarTo: result.after.massarCode }
          : {}),
      },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return result.after;
  }

  async changeClass(auth: AuthContext, studentId: string, dto: ChangeClassDto, client: ClientInfo) {
    const context = toTenantContext(auth);
    const schoolId = requireSchool(auth);

    const result = await this.tenancy.run(context, async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId }, select: { id: true } });
      if (!student) throw new NotFoundException("Élève introuvable.");
      const classroom = await tx.classroom.findFirst({
        where: { id: dto.classroomId },
        select: { id: true, name: true },
      });
      if (!classroom) throw new NotFoundException("Classe introuvable.");

      const previous = await tx.enrollment.findFirst({
        where: { studentId, schoolYear: dto.schoolYear },
        select: { classroom: { select: { id: true, name: true } } },
      });
      if (previous?.classroom.id === classroom.id) {
        throw new ConflictException("L'élève est déjà inscrit dans cette classe pour cette année.");
      }

      await tx.enrollment.upsert({
        where: { studentId_schoolYear: { studentId, schoolYear: dto.schoolYear } },
        update: { classroomId: classroom.id },
        create: { schoolId, studentId, classroomId: classroom.id, schoolYear: dto.schoolYear },
      });

      return { from: previous?.classroom.name ?? null, to: classroom.name, classroomId: classroom.id };
    });

    await this.audit.scoped(context, {
      action: "student.class.changed",
      entity: "Student",
      entityId: studentId,
      metadata: { schoolYear: dto.schoolYear, from: result.from, to: result.to },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return { ok: true, schoolYear: dto.schoolYear, ...result };
  }

  /**
   * Émet (ou renouvelle) le code d'activation d'un élève.
   *
   * Le code en clair n'est retourné qu'à cet instant : la base ne stocke que son
   * SHA-256. Il expire au bout de `ttlDays` (30 par défaut, 365 maximum).
   */
  async issueActivationCode(auth: AuthContext, studentId: string, ttlDaysRaw?: string) {
    const parsed = Number.parseInt(ttlDaysRaw ?? String(DEFAULT_TTL_DAYS), 10);
    const ttlDays = Math.min(
      Math.max(Number.isNaN(parsed) ? DEFAULT_TTL_DAYS : parsed, 1),
      MAX_TTL_DAYS,
    );

    const plainCode = generateActivationCode();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttlDays * 24 * 3600 * 1000);
    const context = toTenantContext(auth);

    const updated = await this.tenancy.run(context, (tx) =>
      tx.student.updateMany({
        where: { id: studentId },
        data: {
          activationCodeHash: sha256(plainCode),
          activationCodeIssuedAt: issuedAt,
          activationCodeExpiresAt: expiresAt,
        },
      }),
    );

    if (updated.count === 0) {
      throw new NotFoundException("Élève introuvable.");
    }

    await this.audit.scoped(context, {
      action: "student.activation_code.issued",
      entity: "Student",
      entityId: studentId,
      severity: "warning",
      metadata: { ttlDays, expiresAt: expiresAt.toISOString() },
    });

    return {
      code: formatActivationCode(plainCode),
      expiresAt,
      ttlDays,
      instruction:
        "À remettre à la famille : code établissement + ce code d'activation. Il n'est plus affiché ensuite.",
    };
  }
}

function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) {
    throw new ForbiddenException("Un établissement actif est requis.");
  }
  return auth.schoolId;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
