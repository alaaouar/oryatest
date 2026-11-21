import "server-only";
import type { AttendanceStatus } from "@prisma/client";
import type {
  AttendanceClassOption,
  AttendanceRegister,
  AttendanceStudentRow,
} from "@/lib/attendance-types";
import { prisma } from "@/lib/prisma";
import { getDemoTenant } from "@/lib/tenant";
import type { AttendanceStatus as UiAttendanceStatus } from "@/lib/demo-attendance";

const statuses: AttendanceStatus[] = ["present", "absent", "late"];

function isAttendanceStatus(value: string): value is AttendanceStatus {
  return statuses.includes(value as AttendanceStatus);
}

function calendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Date invalide.");
  }

  return new Date(`${value}T00:00:00.000Z`);
}

export async function listDemoClasses(): Promise<{
  schoolName: string;
  schoolCity: string;
  classes: AttendanceClassOption[];
}> {
  const tenant = await getDemoTenant();
  const classes = await prisma.class.findMany({
    where: { tenantId: tenant.id },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { students: true } },
    },
  });

  return {
    schoolName: tenant.name,
    schoolCity: tenant.city,
    classes: classes.map((item) => ({
      id: item.id,
      name: item.name,
      cycle: item.cycle,
      studentCount: item._count.students,
    })),
  };
}

export async function getClassRegister(classId: string, date: string) {
  const tenant = await getDemoTenant();
  const day = calendarDate(date);

  const klass = await prisma.class.findFirst({
    where: { id: classId, tenantId: tenant.id },
    include: {
      students: {
        where: { tenantId: tenant.id },
        orderBy: { code: "asc" },
      },
    },
  });

  if (!klass) {
    throw new Error("Classe introuvable pour cet établissement.");
  }

  const records = await prisma.attendanceRecord.findMany({
    where: {
      tenantId: tenant.id,
      classId: klass.id,
      date: day,
    },
  });

  const marks: Record<string, UiAttendanceStatus> = {};
  for (const record of records) {
    marks[record.studentId] = record.status;
  }

  const students: AttendanceStudentRow[] = klass.students.map((student) => ({
    id: student.id,
    code: student.code,
    label: student.label,
  }));

  const register: AttendanceRegister = {
    className: klass.name,
    students,
    marks,
    saved: records.length > 0,
  };

  return register;
}

export async function saveClassRegister(
  classId: string,
  date: string,
  marks: Record<string, UiAttendanceStatus>,
) {
  const tenant = await getDemoTenant();
  const day = calendarDate(date);

  const klass = await prisma.class.findFirst({
    where: { id: classId, tenantId: tenant.id },
    include: {
      students: {
        where: { tenantId: tenant.id },
        select: { id: true },
      },
    },
  });

  if (!klass) {
    throw new Error("Classe introuvable pour cet établissement.");
  }

  if (klass.students.length === 0) {
    throw new Error("Cette classe n'a pas d'élèves.");
  }

  const allowedIds = new Set(klass.students.map((student) => student.id));
  const entries = Object.entries(marks);

  if (entries.length !== allowedIds.size) {
    throw new Error("La liste d'appel ne correspond pas à la classe.");
  }

  for (const [studentId, status] of entries) {
    if (!allowedIds.has(studentId) || !isAttendanceStatus(status)) {
      throw new Error("Statut ou élève non autorisé pour cet établissement.");
    }
  }

  await prisma.$transaction(
    entries.map(([studentId, status]) =>
      prisma.attendanceRecord.upsert({
        where: {
          tenantId_studentId_date: {
            tenantId: tenant.id,
            studentId,
            date: day,
          },
        },
        update: {
          status,
          classId: klass.id,
        },
        create: {
          tenantId: tenant.id,
          classId: klass.id,
          studentId,
          date: day,
          status,
        },
      }),
    ),
  );
}
