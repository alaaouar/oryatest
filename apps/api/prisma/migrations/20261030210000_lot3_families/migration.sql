-- Lot 3 - eleves et familles.
-- Non destructive : ajout de colonnes avec valeur par defaut et d'index.

-- Type d'import : "students" (existant) ou "guardians" (lot 2.1b).
ALTER TABLE "ImportJob" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'students';

-- Coordonnees des familles.
ALTER TABLE "Guardian" ADD COLUMN "address" TEXT;
ALTER TABLE "Guardian" ADD COLUMN "phoneSecondary" TEXT;

CREATE INDEX "Guardian_schoolId_email_idx" ON "Guardian"("schoolId", "email");
CREATE INDEX "Guardian_schoolId_phone_idx" ON "Guardian"("schoolId", "phone");
