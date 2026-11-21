-- Lot 1 (suite) — anti-rejeu TOTP et codes d'activation des élèves.
-- Migration additive : aucune perte de données, aucun verrou long.

-- AlterTable : dernier pas de temps TOTP accepté (fenêtre de 30 s)
ALTER TABLE "User" ADD COLUMN "mfaLastStep" INTEGER;

-- AlterTable : code d'activation long, aléatoire et expirant, stocké haché
ALTER TABLE "Student"
  ADD COLUMN "activationCodeHash" TEXT,
  ADD COLUMN "activationCodeIssuedAt" TIMESTAMP(3),
  ADD COLUMN "activationCodeExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Student_activationCodeHash_key" ON "Student"("activationCodeHash");

-- CreateIndex
CREATE INDEX "Student_activationCodeExpiresAt_idx" ON "Student"("activationCodeExpiresAt");
