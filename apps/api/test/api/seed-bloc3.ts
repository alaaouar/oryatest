/**
 * Fixture Bloc 3 (fichiers) via DIRECT_DATABASE_URL (orya_owner), base jetable.
 * Mot de passe lu dans ORYA_B3_PASSWORD (genere par le script de test, jamais affiche).
 * Ne jamais utiliser en production.
 */
import { createHash } from "node:crypto";
import argon2 from "argon2";
import { PrismaClient, type ProfileRole } from "@prisma/client";
import { schoolYearForDate } from "../../src/core/school-year";

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL;
  const password = process.env.ORYA_B3_PASSWORD;
  if (!url) throw new Error("DIRECT_DATABASE_URL requise");
  if (!password || password.length < 16) throw new Error("ORYA_B3_PASSWORD requise");
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const schoolA = await prisma.school.create({ data: { name: "Ecole B3 A", city: "Rabat", code: "B3TSTA", status: "active" }, select: { id: true } });
    const schoolB = await prisma.school.create({ data: { name: "Ecole B3 B", city: "Fes", code: "B3TSTB", status: "active" }, select: { id: true } });
    async function user(email: string, role: ProfileRole, schoolId: string, name: string) {
      const u = await prisma.user.create({ data: { email, passwordHash, status: "active" }, select: { id: true } });
      const p = await prisma.userProfile.create({ data: { userId: u.id, schoolId, role, displayName: name }, select: { id: true } });
      await prisma.user.update({ where: { id: u.id }, data: { activeProfileId: p.id }, select: { id: true } });
      return { id: u.id, profileId: p.id };
    }
    await user("dir.b3@orya.test", "direction", schoolA.id, "Direction B3");
    await user("dirb.b3@orya.test", "direction", schoolB.id, "Direction B3 B");
    const parent = await user("parent.b3@orya.test", "parent", schoolA.id, "Parent B3");
    const teacher = await user("teacher.b3@orya.test", "teacher", schoolA.id, "Enseignant B3");
    await user("student.b3@orya.test", "student", schoolA.id, "Eleve B3");
    const student = await prisma.student.create({
      data: { schoolId: schoolA.id, studentCode: "B3E001", displayName: "Eleve B3", accountStatus: "none" },
      select: { id: true },
    });
    const g = await prisma.guardian.create({
      data: { schoolId: schoolA.id, userId: parent.id, fullName: "Parent B3", email: "parent.b3@orya.test", phone: "0633333333" },
      select: { id: true },
    });
    await prisma.studentGuardian.create({ data: { schoolId: schoolA.id, studentId: student.id, guardianId: g.id, isPrimary: true } });
    // Bloc 3b : second responsable du MEME enfant, et parent d'un autre enfant de la meme ecole.
    const parent2 = await user("parent2.b3@orya.test", "parent", schoolA.id, "Parent2 B3");
    const g2 = await prisma.guardian.create({
      data: { schoolId: schoolA.id, userId: parent2.id, fullName: "Parent2 B3", email: "parent2.b3@orya.test", phone: "0644444444" },
      select: { id: true },
    });
    await prisma.studentGuardian.create({ data: { schoolId: schoolA.id, studentId: student.id, guardianId: g2.id, isPrimary: false } });
    const parent3 = await user("parent3.b3@orya.test", "parent", schoolA.id, "Parent3 B3");
    const student2 = await prisma.student.create({
      data: { schoolId: schoolA.id, studentCode: "B3E002", displayName: "Eleve2 B3", accountStatus: "none" },
      select: { id: true },
    });
    const g3 = await prisma.guardian.create({
      data: { schoolId: schoolA.id, userId: parent3.id, fullName: "Parent3 B3", email: "parent3.b3@orya.test", phone: "0655555555" },
      select: { id: true },
    });
    await prisma.studentGuardian.create({ data: { schoolId: schoolA.id, studentId: student2.id, guardianId: g3.id, isPrimary: true } });
    const year = schoolYearForDate(new Date());
    const classroom = await prisma.classroom.create({ data: { schoolId: schoolA.id, name: "B3-6A" }, select: { id: true } });
    await prisma.enrollment.create({ data: { schoolId: schoolA.id, studentId: student.id, classroomId: classroom.id, schoolYear: year } });
    await prisma.teacherClassroomAssignment.create({
      data: { schoolId: schoolA.id, teacherProfileId: teacher.profileId, classroomId: classroom.id, schoolYear: year },
    });
    const body = "Texte de consentement parental v0 FR - fixture bloc 3, tests uniquement.";
    const text = await prisma.consentText.create({
      data: {
        purpose: "student_account",
        version: "v0",
        locale: "fr",
        body,
        bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
        status: "validated",
        effectiveAt: new Date(),
        legalDocumentRef: "FIXTURE-TEST-ONLY",
        legalValidatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    process.stdout.write(
      JSON.stringify({
        studentId: student.id,
        textId: text.id,
        dirEmail: "dir.b3@orya.test",
        dirBEmail: "dirb.b3@orya.test",
        parentEmail: "parent.b3@orya.test",
        teacherEmail: "teacher.b3@orya.test",
        studentEmail: "student.b3@orya.test",
        parent2Email: "parent2.b3@orya.test",
        parent3Email: "parent3.b3@orya.test",
        student2Id: student2.id,
        classroomId: classroom.id,
        schoolAId: schoolA.id,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});