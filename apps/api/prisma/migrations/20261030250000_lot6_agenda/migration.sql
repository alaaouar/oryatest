-- Lot 6 : agenda et devoirs (tables nouvelles uniquement).
-- CreateEnum
CREATE TYPE "AgendaKind" AS ENUM ('homework', 'test', 'class_event', 'important_date');

-- CreateTable
CREATE TABLE "AgendaItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "classroomId" UUID,
    "kind" "AgendaKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" DATE NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "authorId" UUID NOT NULL,
    "authorRole" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaAttachment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "agendaItemId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendaAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgendaItem_schoolId_classroomId_date_idx" ON "AgendaItem"("schoolId", "classroomId", "date");

-- CreateIndex
CREATE INDEX "AgendaItem_schoolId_date_idx" ON "AgendaItem"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaAttachment_fileId_key" ON "AgendaAttachment"("fileId");

-- CreateIndex
CREATE INDEX "AgendaAttachment_schoolId_agendaItemId_idx" ON "AgendaAttachment"("schoolId", "agendaItemId");

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaAttachment" ADD CONSTRAINT "AgendaAttachment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaAttachment" ADD CONSTRAINT "AgendaAttachment_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AgendaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaAttachment" ADD CONSTRAINT "AgendaAttachment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
