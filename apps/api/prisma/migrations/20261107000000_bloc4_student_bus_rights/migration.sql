-- Bloc 4 : profil eleve (UserProfile.studentId), statut du bus (sans position),
-- export des donnees personnelles (asynchrone, 7 jours), demandes de rectification / opposition.

-- CreateEnum
CREATE TYPE "BusStatus" AS ENUM ('not_planned', 'waiting', 'on_board', 'dropped_off', 'absent');

-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('pending', 'processing', 'ready', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "DataRightsKind" AS ENUM ('rectification', 'opposition');

-- CreateEnum
CREATE TYPE "DataRightsStatus" AS ENUM ('open', 'closed');

-- AlterTable
ALTER TABLE "UserProfile" ADD COLUMN     "studentId" UUID;

-- CreateTable
CREATE TABLE "StudentBusStatus" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "status" "BusStatus" NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentBusStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExportRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "jsonFileId" UUID,
    "pdfFileId" UUID,
    "error" TEXT,

    CONSTRAINT "DataExportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRightsRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "DataRightsKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "DataRightsStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),
    "handledById" UUID,
    "response" TEXT,

    CONSTRAINT "DataRightsRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentBusStatus_schoolId_date_idx" ON "StudentBusStatus"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StudentBusStatus_studentId_date_key" ON "StudentBusStatus"("studentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DataExportRequest_jsonFileId_key" ON "DataExportRequest"("jsonFileId");

-- CreateIndex
CREATE UNIQUE INDEX "DataExportRequest_pdfFileId_key" ON "DataExportRequest"("pdfFileId");

-- CreateIndex
CREATE INDEX "DataExportRequest_status_requestedAt_idx" ON "DataExportRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "DataExportRequest_userId_idx" ON "DataExportRequest"("userId");

-- CreateIndex
CREATE INDEX "DataRightsRequest_schoolId_status_idx" ON "DataRightsRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "DataRightsRequest_userId_idx" ON "DataRightsRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_studentId_key" ON "UserProfile"("studentId");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentBusStatus" ADD CONSTRAINT "StudentBusStatus_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentBusStatus" ADD CONSTRAINT "StudentBusStatus_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_jsonFileId_fkey" FOREIGN KEY ("jsonFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportRequest" ADD CONSTRAINT "DataExportRequest_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRightsRequest" ADD CONSTRAINT "DataRightsRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataRightsRequest" ADD CONSTRAINT "DataRightsRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

