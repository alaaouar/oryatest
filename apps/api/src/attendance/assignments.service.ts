import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth.types";
import { toTenantContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { TenancyService } from "../core/tenancy.service";
import type { CreateAssignmentDto } from "./attendance.dto";

/**
 * Affectations enseignant ↔ classe (Lot 2.2).
 * schoolId toujours issu du jeton, jamais du corps de requête.
 */
@Injectable()
export class AssignmentsService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext) {
    const context = toTenantContext(auth);
    if (!auth.schoolId) {
      throw new ForbiddenException("Un établissement actif est requis.");
    }

    return this.tenancy.run(context, (tx) =>
      tx.teacherClassroomAssignment.findMany({
        orderBy: [{ schoolYear: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          schoolYear: true,
          classroomId: true,
          teacherProfileId: true,
          createdAt: true,
          classroom: { select: { id: true, name: true } },
          teacherProfile: { select: { id: true, displayName: true, role: true } },
        },
      }),
    );
  }

  async create(auth: AuthContext, dto: CreateAssignmentDto, client: ClientInfo) {
    const context = toTenantContext(auth);
    if (!auth.schoolId) {
      throw new ForbiddenException("Un établissement actif est requis.");
    }
    const schoolId = auth.schoolId;

    const created = await this.tenancy.run(context, async (tx) => {
      const classroom = await tx.classroom.findFirst({
        where: { id: dto.classroomId },
        select: { id: true },
      });
      if (!classroom) {
        throw new NotFoundException("Classe introuvable.");
      }

      const teacher = await tx.userProfile.findFirst({
        where: { id: dto.teacherProfileId, schoolId, role: "teacher" },
        select: { id: true },
      });
      if (!teacher) {
        throw new BadRequestException("Le profil enseignant est introuvable dans cet établissement.");
      }

      try {
        return await tx.teacherClassroomAssignment.create({
          data: {
            schoolId,
            teacherProfileId: dto.teacherProfileId,
            classroomId: dto.classroomId,
            schoolYear: dto.schoolYear,
            createdById: auth.userId,
          },
          select: {
            id: true,
            schoolYear: true,
            classroomId: true,
            teacherProfileId: true,
            createdAt: true,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException("Cette affectation existe déjà pour l'année scolaire.");
        }
        throw error;
      }
    });

    await this.audit.scoped(context, {
      action: "assignment.created",
      entity: "TeacherClassroomAssignment",
      entityId: created.id,
      metadata: {
        classroomId: created.classroomId,
        teacherProfileId: created.teacherProfileId,
        schoolYear: created.schoolYear,
      },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return created;
  }

  async remove(auth: AuthContext, assignmentId: string, client: ClientInfo) {
    const context = toTenantContext(auth);
    if (!auth.schoolId) {
      throw new ForbiddenException("Un établissement actif est requis.");
    }

    const result = await this.tenancy.run(context, (tx) =>
      tx.teacherClassroomAssignment.deleteMany({ where: { id: assignmentId } }),
    );

    if (result.count === 0) {
      throw new NotFoundException("Affectation introuvable.");
    }

    await this.audit.scoped(context, {
      action: "assignment.deleted",
      entity: "TeacherClassroomAssignment",
      entityId: assignmentId,
      severity: "warning",
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return { ok: true };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
