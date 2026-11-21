-- CreateEnum
CREATE TYPE "SchoolBillingStatus" AS ENUM ('trial', 'invoiced', 'paid', 'overdue', 'suspended');

-- CreateEnum
CREATE TYPE "SchoolInvoiceKind" AS ENUM ('invoice', 'complementary', 'credit_note');

-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "endsOn" DATE,
ADD COLUMN     "startsOn" DATE;

-- CreateTable
CREATE TABLE "SchoolContract" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "unitPriceHtMinor" INTEGER NOT NULL DEFAULT 10000,
    "vatRateBp" INTEGER NOT NULL DEFAULT 2000,
    "unitPriceTtcMinor" INTEGER NOT NULL DEFAULT 12000,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "status" "SchoolBillingStatus" NOT NULL DEFAULT 'trial',
    "trialEndsOn" DATE,
    "paymentTermDays" INTEGER NOT NULL DEFAULT 30,
    "noticeDays" INTEGER NOT NULL DEFAULT 15,
    "referenceMonthDay" TEXT NOT NULL DEFAULT '10-31',
    "statusChangedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolInvoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "kind" "SchoolInvoiceKind" NOT NULL,
    "number" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "annualKey" TEXT,
    "schoolYear" TEXT NOT NULL,
    "referenceDate" DATE NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceHtMinor" INTEGER NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "totalHtMinor" INTEGER NOT NULL,
    "totalVatMinor" INTEGER NOT NULL,
    "totalTtcMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "relatedInvoiceId" UUID,
    "reason" TEXT,
    "countedStudentIds" JSONB NOT NULL,
    "issuer" JSONB NOT NULL,
    "client" JSONB NOT NULL,
    "createdById" UUID,

    CONSTRAINT "SchoolInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolPayment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "receivedOn" DATE NOT NULL,
    "bankReference" TEXT NOT NULL,
    "note" TEXT,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "series" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("series","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolContract_schoolId_key" ON "SchoolContract"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolContract_reference_key" ON "SchoolContract"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolInvoice_number_key" ON "SchoolInvoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolInvoice_annualKey_key" ON "SchoolInvoice"("annualKey");

-- CreateIndex
CREATE INDEX "SchoolInvoice_schoolId_issuedAt_idx" ON "SchoolInvoice"("schoolId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolInvoice_series_year_seq_key" ON "SchoolInvoice"("series", "year", "seq");

-- CreateIndex
CREATE INDEX "SchoolPayment_schoolId_receivedOn_idx" ON "SchoolPayment"("schoolId", "receivedOn");

-- AddForeignKey
ALTER TABLE "SchoolContract" ADD CONSTRAINT "SchoolContract_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "SchoolContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_relatedInvoiceId_fkey" FOREIGN KEY ("relatedInvoiceId") REFERENCES "SchoolInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPayment" ADD CONSTRAINT "SchoolPayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPayment" ADD CONSTRAINT "SchoolPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SchoolInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Bloc 5 : coherence des montants et des documents (contraintes CHECK, non modelisees par Prisma).
ALTER TABLE "SchoolContract" ADD CONSTRAINT "SchoolContract_amounts_chk" CHECK (
  "unitPriceHtMinor" > 0 AND "vatRateBp" BETWEEN 0 AND 10000
  AND "unitPriceTtcMinor" = "unitPriceHtMinor" + round("unitPriceHtMinor"::numeric * "vatRateBp" / 10000)
  AND "paymentTermDays" BETWEEN 1 AND 365 AND "noticeDays" BETWEEN 0 AND 365
  AND "referenceMonthDay" ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
);

ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_amounts_chk" CHECK (
  "quantity" > 0 AND "unitPriceHtMinor" > 0 AND "vatRateBp" BETWEEN 0 AND 10000
  AND "totalHtMinor" = "quantity" * "unitPriceHtMinor"
  AND "totalVatMinor" = round("totalHtMinor"::numeric * "vatRateBp" / 10000)
  AND "totalTtcMinor" = "totalHtMinor" + "totalVatMinor"
);

ALTER TABLE "SchoolInvoice" ADD CONSTRAINT "SchoolInvoice_kind_chk" CHECK (
  ("kind" = 'invoice' AND "series" = 'FA' AND "relatedInvoiceId" IS NULL AND "annualKey" IS NOT NULL)
  OR ("kind" = 'complementary' AND "series" = 'FA' AND "relatedInvoiceId" IS NOT NULL AND "annualKey" IS NULL)
  OR ("kind" = 'credit_note' AND "series" = 'AV' AND "relatedInvoiceId" IS NOT NULL AND "annualKey" IS NULL)
);

ALTER TABLE "SchoolPayment" ADD CONSTRAINT "SchoolPayment_amount_chk" CHECK ("amountMinor" > 0 AND length("bankReference") BETWEEN 3 AND 120);

ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_chk" CHECK ("series" IN ('FA', 'AV') AND "lastValue" >= 0);

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_dates_chk" CHECK ("startsOn" IS NULL OR "endsOn" IS NULL OR "endsOn" > "startsOn");
