-- Lot 9 : abonnements et administration SaaS (non destructif).
-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'suspended';
ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'cancelled';

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'void');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "planId" UUID,
ADD COLUMN "statusChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxStudents" INTEGER,
    "maxStaff" INTEGER,
    "trialDays" INTEGER,
    "priceMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "toBeDefined" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "planCode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "amountMinor" INTEGER,
    "lines" JSONB NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'none',
    "providerRef" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "UsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "Invoice_schoolId_createdAt_idx" ON "Invoice"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageSnapshot_schoolId_takenAt_idx" ON "UsageSnapshot"("schoolId", "takenAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageSnapshot" ADD CONSTRAINT "UsageSnapshot_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Plans PLACEHOLDERS : noms, limites et prix A DEFINIR par Ayoub (null = non defini, non applique).
INSERT INTO "Plan" ("code", "name", "toBeDefined", "notes", "updatedAt") VALUES
  ('plan-a-definir-1', 'Plan 1 (a definir)', true, 'Placeholder : limites et prix a definir par Ayoub.', CURRENT_TIMESTAMP),
  ('plan-a-definir-2', 'Plan 2 (a definir)', true, 'Placeholder : limites et prix a definir par Ayoub.', CURRENT_TIMESTAMP),
  ('plan-a-definir-3', 'Plan 3 (a definir)', true, 'Placeholder : limites et prix a definir par Ayoub.', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
