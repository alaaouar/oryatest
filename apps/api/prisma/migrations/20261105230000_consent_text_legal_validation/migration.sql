-- Bloc 3 / point 4 : validation juridique d'un texte de consentement.
-- Additive : 3 colonnes nullables + 1 contrainte. Un texte valide doit porter la
-- reference du document de validation juridique et sa date.
-- Les textes deja valides sans reference (aucun en production : pilote non ouvert)
-- doivent etre completes AVANT cette migration, sinon elle echoue (voulu).
ALTER TABLE "ConsentText" ADD COLUMN "legalDocumentRef" TEXT;
ALTER TABLE "ConsentText" ADD COLUMN "legalValidatedAt" DATE;
ALTER TABLE "ConsentText" ADD COLUMN "validatedById" UUID;
ALTER TABLE "ConsentText"
  ADD CONSTRAINT "ConsentText_validated_requires_legal_ref"
  CHECK ("status" = 'draft' OR ("legalDocumentRef" IS NOT NULL AND "legalValidatedAt" IS NOT NULL));