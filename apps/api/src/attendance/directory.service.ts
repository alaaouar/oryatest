import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuthContext } from "../auth/auth.types";
import { toTenantContext } from "../auth/auth.types";
import { schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";

/**
 * Lectures de référence pour l'interface des présences (Lot 2.3) :
 * classes de l'établissement et enseignants affectables.
 *
 * Règles :
 *  - schoolId exclusivement issu du jeton (RLS + filtre explicite) ;
 *  - enseignant : ne voit que les classes qui lui sont affectées pour l'année ;
 *  - aucun e-mail ni donnée de contact n'est exposé.
 */
@Injectable()
export class DirectoryService {
  constructor(private readonly tenancy: TenancyService) {}

  async listClassrooms(auth: AuthContext, schoolYearRaw?: string) {
    const schoolId = requireSchool(auth);
    const schoolYear = schoolYearRaw ?? schoolYearForDate(new Date());

    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const where =
        auth.role === "teacher"
          ? {
              schoolId,
              assignments: { some: { teacherProfileId: auth.profileId, schoolYear } },
            }
          : { schoolId };

      const classrooms = await tx.classroom.findMany({
        where,
        orderBy: [{ cycle: "asc" }, { level: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          cycle: true,
          level: true,
          _count: { select: { enrollments: { where: { schoolYear } } } },
          assignments: {
            where: { schoolYear },
            select: {
              id: true,
              teacherProfile: { select: { id: true, displayName: true } },
            },
          },
        },
      });

      return {
        schoolYear,
        classrooms: classrooms.map((classroom) => ({
          id: classroom.id,
          name: classroom.name,
          cycle: classroom.cycle,
          level: classroom.level,
          studentCount: classroom._count.enrollments,
          teachers: classroom.assignments.map((assignment) => ({
            assignmentId: assignment.id,
            profileId: assignment.teacherProfile.id,
            displayName: assignment.teacherProfile.displayName,
          })),
        })),
      };
    });
  }

  async listTeachers(auth: AuthContext) {
    const schoolId = requireSchool(auth);

    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const teachers = await tx.userProfile.findMany({
        where: { schoolId, role: "teacher" },
        orderBy: { displayName: "asc" },
        select: {
          id: true,
          displayName: true,
          createdAt: true,
          _count: { select: { classroomAssignments: true } },
        },
      });

      return {
        teachers: teachers.map((teacher) => ({
          id: teacher.id,
          displayName: teacher.displayName,
          createdAt: teacher.createdAt,
          assignmentCount: teacher._count.classroomAssignments,
        })),
      };
    });
  }
}

function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) {
    throw new ForbiddenException("Un établissement actif est requis.");
  }
  return auth.schoolId;
}