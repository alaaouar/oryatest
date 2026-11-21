-- t92 M4 : statut de justificatif « à compléter » et carte « À faire » liée au justificatif.
-- Non destructif : ajout d'une valeur d'enum et d'une colonne nullable.
ALTER TYPE "JustificationStatus" ADD VALUE IF NOT EXISTS 'incomplete';

ALTER TABLE "ParentAction" ADD COLUMN "justificationId" UUID;

CREATE INDEX "ParentAction_justificationId_idx" ON "ParentAction"("justificationId");

ALTER TABLE "ParentAction" ADD CONSTRAINT "ParentAction_justificationId_fkey" FOREIGN KEY ("justificationId") REFERENCES "AbsenceJustification"("id") ON DELETE SET NULL ON UPDATE CASCADE;
