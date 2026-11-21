-- Bloc 3 : fichiers (antivirus, chiffrement, conservation, scan du consentement papier).
-- Additive. Les fichiers existants passent en scanStatus='pending' : ils ne sont plus
-- telechargeables (justificatifs, scans) tant qu'ils n'ont pas ete analyses (echec ferme).
CREATE TYPE "FileScanStatus" AS ENUM ('pending', 'clean', 'infected', 'error');

ALTER TABLE "StoredFile"
  ADD COLUMN "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "scannedAt" TIMESTAMP(3),
  ADD COLUMN "scanEngine" TEXT,
  ADD COLUMN "encryption" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "retentionUntil" TIMESTAMP(3),
  ADD COLUMN "purgedAt" TIMESTAMP(3);
CREATE INDEX "StoredFile_retentionUntil_idx" ON "StoredFile"("retentionUntil");

ALTER TABLE "ParentalConsent" ADD COLUMN "paperFileId" UUID;
CREATE UNIQUE INDEX "ParentalConsent_paperFileId_key" ON "ParentalConsent"("paperFileId");
ALTER TABLE "ParentalConsent"
  ADD CONSTRAINT "ParentalConsent_paperFileId_fkey" FOREIGN KEY ("paperFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;