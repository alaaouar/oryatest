-- t92 M2 : calendrier de l'etablissement (jours ouvres, vacances / jours feries). Tables nouvelles, non destructif.
-- RLS : prisma/sql/010_rls.sql (school_calendar_isolation, school_holiday_isolation).
-- CreateTable
CREATE TABLE "SchoolCalendar" (
    "schoolId" UUID NOT NULL,
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolCalendar_pkey" PRIMARY KEY ("schoolId")
);

-- CreateTable
CREATE TABLE "SchoolHoliday" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolHoliday_schoolId_startDate_idx" ON "SchoolHoliday"("schoolId", "startDate");

-- AddForeignKey
ALTER TABLE "SchoolCalendar" ADD CONSTRAINT "SchoolCalendar_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolHoliday" ADD CONSTRAINT "SchoolHoliday_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
