-- Lot 8 : historique des exports compatibles saisie Massar (non destructif).
-- CreateTable
CREATE TABLE "MassarExport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "report" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "schoolYear" TEXT NOT NULL,
    "fromDate" DATE,
    "toDate" DATE,
    "rowCount" INTEGER NOT NULL,
    "anomalyCount" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "columnsVersion" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MassarExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MassarExport_schoolId_createdAt_idx" ON "MassarExport"("schoolId", "createdAt");

-- AddForeignKey
ALTER TABLE "MassarExport" ADD CONSTRAINT "MassarExport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
