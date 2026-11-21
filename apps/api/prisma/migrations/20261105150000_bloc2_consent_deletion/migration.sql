-- Bloc 2 : consentement parental (J1.1) + suppression de compte (J1.2)
-- Migration additive. Aucune donnee existante reecrite.

-- Textes de consentement versionnes (FR/AR), immuables cote application.
CREATE TYPE "ConsentPurpose" AS ENUM ('student_account', 'transport_alerts');
CREATE TYPE "ConsentTextStatus" AS ENUM ('draft', 'validated');
CREATE TYPE "ConsentChannel" AS ENUM ('web', 'mobile', 'paper_school');
CREATE TYPE "StudentAccountStatus" AS ENUM ('none', 'active', 'suspended_no_consent');
CREATE TYPE "AccountDeletionKind" AS ENUM ('self', 'student_by_guardian', 'student_by_school');
CREATE TYPE "AccountDeletionStatus" AS ENUM ('pending', 'cancelled', 'completed');

CREATE TABLE "ConsentText" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" "ConsentPurpose" NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "bodySha256" TEXT NOT NULL,
    "status" "ConsentTextStatus" NOT NULL DEFAULT 'draft',
    "effectiveAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsentText_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConsentText_purpose_version_locale_key" ON "ConsentText"("purpose", "version", "locale");
CREATE INDEX "ConsentText_purpose_status_idx" ON "ConsentText"("purpose", "status");

-- Consentement parental (table dediee : Consent reste reserve CGU/privacy).
CREATE TABLE "ParentalConsent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "guardianId" UUID,
    "userId" UUID,
    "purpose" "ConsentPurpose" NOT NULL DEFAULT 'student_account',
    "textId" UUID NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "guardianName" TEXT,
    "paperDate" DATE,
    "paperFileReference" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "ParentalConsent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ParentalConsent_schoolId_studentId_idx" ON "ParentalConsent"("schoolId", "studentId");
CREATE INDEX "ParentalConsent_guardianId_idx" ON "ParentalConsent"("guardianId");
CREATE INDEX "ParentalConsent_textId_idx" ON "ParentalConsent"("textId");
-- Un seul consentement ACTIF par (eleve, responsable|papier, finalite)
CREATE UNIQUE INDEX "ParentalConsent_active_guardian_key"
  ON "ParentalConsent"("studentId", "guardianId", "purpose")
  WHERE "revokedAt" IS NULL AND "guardianId" IS NOT NULL;
CREATE UNIQUE INDEX "ParentalConsent_active_paper_key"
  ON "ParentalConsent"("studentId", "purpose", "paperFileReference")
  WHERE "revokedAt" IS NULL AND "channel" = 'paper_school';

ALTER TABLE "ParentalConsent"
  ADD CONSTRAINT "ParentalConsent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ParentalConsent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ParentalConsent_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ParentalConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ParentalConsent_textId_fkey" FOREIGN KEY ("textId") REFERENCES "ConsentText"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ParentalConsent_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Student" ADD COLUMN "accountStatus" "StudentAccountStatus" NOT NULL DEFAULT 'none';
CREATE INDEX "Student_schoolId_accountStatus_idx" ON "Student"("schoolId", "accountStatus");

ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE TABLE "AccountDeletionRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "studentId" UUID,
    "schoolId" UUID,
    "kind" "AccountDeletionKind" NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'pending',
    "requestedById" UUID,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "requestIp" TEXT,
    CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AccountDeletionRequest_status_effectiveAt_idx" ON "AccountDeletionRequest"("status", "effectiveAt");
CREATE INDEX "AccountDeletionRequest_userId_idx" ON "AccountDeletionRequest"("userId");
CREATE INDEX "AccountDeletionRequest_studentId_idx" ON "AccountDeletionRequest"("studentId");
ALTER TABLE "AccountDeletionRequest"
  ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AccountDeletionRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AccountDeletionRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AccountDeletionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Registre des suppressions (empreintes) a rejouer apres restauration de sauvegarde.
CREATE TABLE "DeletionRegister" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "emailHash" TEXT NOT NULL,
    "userIdHash" TEXT NOT NULL,
    "studentIdHash" TEXT,
    "schoolIdHash" TEXT,
    "kind" "AccountDeletionKind" NOT NULL,
    "anonymizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceRequestId" UUID,
    CONSTRAINT "DeletionRegister_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeletionRegister_emailHash_key" ON "DeletionRegister"("emailHash");
CREATE INDEX "DeletionRegister_userIdHash_idx" ON "DeletionRegister"("userIdHash");
