/**
 * C6 (t52u) : fixture E2E de l'espace eleve, base JETABLE uniquement (appelee par e2e/run-e2e.ps1).
 * Cree un texte de consentement "student_account" valide (reference FIXTURE-TEST-ONLY) et une
 * invitation eleve pour le 1er eleve de ecole-a. Le consentement parental lui-meme est donne par
 * le parent via l'API REELLE dans le test Playwright. Le jeton est ecrit dans un fichier temporaire
 * (jamais sur la sortie standard), lu par le test, puis supprime par run-e2e.ps1.
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const url = process.env.DIRECT_DATABASE_URL ?? "";
const out = process.env.ORYA_E2E_STUDENT_FIXTURE ?? "";
if (!url || !out) {
  console.error("DIRECT_DATABASE_URL ou ORYA_E2E_STUDENT_FIXTURE absente.");
  process.exit(1);
}
const prisma = new PrismaClient({ datasourceUrl: url });
const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

async function main() {
  const guardian = await prisma.guardian.findFirstOrThrow({
    where: { email: "parent1@ecole-a.orya.test" },
    select: { id: true, schoolId: true },
  });
  const school = { id: guardian.schoolId };
  const link = await prisma.studentGuardian.findFirstOrThrow({
    where: { schoolId: school.id, guardianId: guardian.id },
    orderBy: { createdAt: "asc" },
    select: { studentId: true },
  });
  const body = "Texte de consentement FICTIF pour les tests E2E (compte eleve). Non juridique.";
  const text = await prisma.consentText.create({
    data: {
      purpose: "student_account",
      version: "e2e",
      locale: "fr",
      body,
      bodySha256: sha(body),
      status: "validated",
      effectiveAt: new Date(),
      legalDocumentRef: "FIXTURE-TEST-ONLY",
      legalValidatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    select: { id: true },
  });
  const secret = randomBytes(24).toString("base64url");
  await prisma.invitation.create({
    data: {
      schoolId: school.id,
      role: "student",
      email: "eleve1@ecole-a.orya.test",
      tokenHash: sha(secret),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      studentId: link.studentId,
    },
  });
  writeFileSync(
    out,
    JSON.stringify({ token: `inv.${school.id}.${secret}`, studentId: link.studentId, textId: text.id, email: "eleve1@ecole-a.orya.test" }),
    { encoding: "utf8", mode: 0o600 },
  );
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : "fixture eleve en echec");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
