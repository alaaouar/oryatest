/**
 * Fixture Bloc 2 : textes VALIDES inseres via DIRECT_DATABASE_URL (orya_owner).
 * Un texte DRAFT existe pour verifier le refus sur compte reel.
 * Ne jamais utiliser en production.
 */
import { createHash } from "node:crypto";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

function sha(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL requise");
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const passwordHash = await argon2.hash("Bloc2-Passw0rd!", { type: argon2.argon2id });
    const school = await prisma.school.create({
      data: { name: "Ecole B2", city: "Casa", code: "B2TEST", status: "active" },
      select: { id: true },
    });
    async function user(email: string, role: "direction" | "parent", name: string) {
      const u = await prisma.user.create({ data: { email, passwordHash, status: "active" }, select: { id: true } });
      const p = await prisma.userProfile.create({
        data: { userId: u.id, schoolId: school.id, role, displayName: name },
        select: { id: true },
      });
      await prisma.user.update({ where: { id: u.id }, data: { activeProfileId: p.id }, select: { id: true } });
      return u;
    }
    const dir = await user("dir.b2@orya.test", "direction", "Direction B2");
    {
      const su = await prisma.user.create({ data: { email: "super.b2@orya.test", passwordHash, status: "active" }, select: { id: true } });
      const sp = await prisma.userProfile.create({ data: { userId: su.id, schoolId: null, role: "super_admin", displayName: "Super B2" }, select: { id: true } });
      await prisma.user.update({ where: { id: su.id }, data: { activeProfileId: sp.id }, select: { id: true } });
    }
    await user("dir2.b2@orya.test", "direction", "Direction 2 B2");
    const parent = await user("parent.b2@orya.test", "parent", "Parent B2");
    const parent2 = await user("parent2.b2@orya.test", "parent", "Parent2 B2");
    const student = await prisma.student.create({
      data: { schoolId: school.id, studentCode: "E001", displayName: "Eleve B2", accountStatus: "none" },
      select: { id: true },
    });
    const g1 = await prisma.guardian.create({
      data: { schoolId: school.id, userId: parent.id, fullName: "Parent Un", email: "parent.b2@orya.test", phone: "0611111111" },
      select: { id: true },
    });
    const g2 = await prisma.guardian.create({
      data: { schoolId: school.id, userId: parent2.id, fullName: "Parent Deux", email: "parent2.b2@orya.test", phone: "0622222222" },
      select: { id: true },
    });
    await prisma.studentGuardian.create({ data: { schoolId: school.id, studentId: student.id, guardianId: g1.id, isPrimary: true } });
    await prisma.studentGuardian.create({ data: { schoolId: school.id, studentId: student.id, guardianId: g2.id, isPrimary: false } });
    const bodyFr = "Texte de consentement parental v0 FR - autorisation espace eleve.";
    const bodyAr = "Nass muwafaqa waliy v0 AR - autorisation espace eleve.";
    const draft = await prisma.consentText.create({
      data: {
        purpose: "student_account",
        version: "v0-draft",
        locale: "fr",
        body: `${bodyFr} DRAFT`,
        bodySha256: sha(`${bodyFr} DRAFT`),
        status: "draft",
      },
      select: { id: true },
    });
    const draft2 = await prisma.consentText.create({
      data: {
        purpose: "transport_alerts",
        version: "v0-draft",
        locale: "fr",
        body: "Texte transport v0 FR - brouillon a valider par le juriste.",
        bodySha256: sha("Texte transport v0 FR - brouillon a valider par le juriste."),
        status: "draft",
      },
      select: { id: true },
    });
    const fr = await prisma.consentText.create({
      data: {
        purpose: "student_account",
        version: "v0",
        locale: "fr",
        body: bodyFr,
        bodySha256: sha(bodyFr),
        status: "validated",
        effectiveAt: new Date(),
        legalDocumentRef: "FIXTURE-TEST-ONLY",
        legalValidatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    const ar = await prisma.consentText.create({
      data: {
        purpose: "student_account",
        version: "v0",
        locale: "ar",
        body: bodyAr,
        bodySha256: sha(bodyAr),
        status: "validated",
        effectiveAt: new Date(),
        legalDocumentRef: "FIXTURE-TEST-ONLY",
        legalValidatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    process.stdout.write(
      JSON.stringify({
        schoolId: school.id,
        studentId: student.id,
        draftId: draft.id,
        draft2Id: draft2.id,
        superEmail: "super.b2@orya.test",
        textFrId: fr.id,
        textArId: ar.id,
        dirEmail: "dir.b2@orya.test",
        parentEmail: "parent.b2@orya.test",
        parent2Email: "parent2.b2@orya.test",
        password: "Bloc2-Passw0rd!",
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
