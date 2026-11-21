-- Lot 2.2 — affectations enseignant-classe et sessions d'appel / présences.
-- Migration non destructive : CREATE uniquement.

CREATE TYPE "AttendanceSlot" AS ENUM ('morning', 'afternoon');

CREATE TYPE "AttendanceSessionStatus" AS ENUM ('open', 'closed');

CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'late');

CREATE TABLE "TeacherClassroomAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "teacherProfileId" UUID NOT NULL,
    "classroomId" UUID NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherClassroomAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "classroomId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slot" "AttendanceSlot" NOT NULL,
    "status" "AttendanceSessionStatus" NOT NULL DEFAULT 'open',
    "schoolYear" TEXT NOT NULL,
    "openedById" UUID,
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "reopenedAt" TIMESTAMP(3),
    "reopenedById" UUID,
    "reopenReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceRow" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "clientMutationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeacherAssignment_school_teacher_class_year_key"
  ON "TeacherClassroomAssignment"("schoolId", "teacherProfileId", "classroomId", "schoolYear");

CREATE INDEX "TeacherClassroomAssignment_schoolId_classroomId_idx"
  ON "TeacherClassroomAssignment"("schoolId", "classroomId");

CREATE INDEX "TeacherClassroomAssignment_schoolId_teacherProfileId_idx"
  ON "TeacherClassroomAssignment"("schoolId", "teacherProfileId");

CREATE UNIQUE INDEX "AttendanceSession_schoolId_classroomId_date_slot_key"
  ON "AttendanceSession"("schoolId", "classroomId", "date", "slot");

CREATE INDEX "AttendanceSession_schoolId_date_idx"
  ON "AttendanceSession"("schoolId", "date");

CREATE INDEX "AttendanceSession_schoolId_classroomId_idx"
  ON "AttendanceSession"("schoolId", "classroomId");

CREATE UNIQUE INDEX "AttendanceRow_sessionId_studentId_key"
  ON "AttendanceRow"("sessionId", "studentId");

CREATE UNIQUE INDEX "AttendanceRow_clientMutationId_key"
  ON "AttendanceRow"("clientMutationId");

CREATE INDEX "AttendanceRow_schoolId_sessionId_idx"
  ON "AttendanceRow"("schoolId", "sessionId");

CREATE INDEX "AttendanceRow_schoolId_studentId_idx"
  ON "AttendanceRow"("schoolId", "studentId");

ALTER TABLE "TeacherClassroomAssignment"
  ADD CONSTRAINT "TeacherClassroomAssignment_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherClassroomAssignment"
  ADD CONSTRAINT "TeacherClassroomAssignment_teacherProfileId_fkey"
  FOREIGN KEY ("teacherProfileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeacherClassroomAssignment"
  ADD CONSTRAINT "TeacherClassroomAssignment_classroomId_fkey"
  FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceSession"
  ADD CONSTRAINT "AttendanceSession_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceSession"
  ADD CONSTRAINT "AttendanceSession_classroomId_fkey"
  FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceRow"
  ADD CONSTRAINT "AttendanceRow_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceRow"
  ADD CONSTRAINT "AttendanceRow_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttendanceRow"
  ADD CONSTRAINT "AttendanceRow_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
