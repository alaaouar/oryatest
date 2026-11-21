/**
 * Fixture Bloc 4 (eleve, bus, export, droits) via DIRECT_DATABASE_URL (orya_owner), base jetable.
 * Mot de passe lu dans ORYA_B4_PASSWORD (genere par le script de test, jamais affiche).
 * Ne jamais utiliser en production.
 */
import { createHash } from "node:crypto";
import argon2 from "argon2";
import { PrismaClient, type ProfileRole } from "@prisma/client";
import { schoolYearForDate } from "../../src/core/school-year";

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL;
  const password = process.env.ORYA_B4_PASSWORD;
  if (!url) throw new Error("DIRECT_DATABASE_URL requise");
  if (!password || password.length < 16) throw new Error("ORYA_B4_PASSWORD requise");
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const A = (await prisma.school.create({ data: { name: "Ecole B4 A", city: "Rabat", code: "B4TSTA", status: "active" }, select: { id: true } })).id;
    const B = (await prisma.school.create({ data: { name: "Ecole B4 B", city: "Fes", code: "B4TSTB", status: "active" }, select: { id: true } })).id;
    async function user(email: string, role: ProfileRole, schoolId: string, name: string) {
      const u = await prisma.user.create({ data: { email, passwordHash, status: "active" }, select: { id: true } });
      const p = await prisma.userProfile.create({ data: { userId: u.id, schoolId, role, displayName: name }, select: { id: true } });
      await prisma.user.update({ where: { id: u.id }, data: { activeProfileId: p.id }, select: { id: true } });
      return { id: u.id, profileId: p.id };
    }
    async function guardianOf(userId: string, email: string, name: string, students: string[]) {
      const g = await prisma.guardian.create({ data: { schoolId: A, userId, fullName: name, email, phone: "0600000000" }, select: { id: true } });
      for (const s of students) await prisma.studentGuardian.create({ data: { schoolId: A, studentId: s, guardianId: g.id } });
      return g.id;
    }
    const student = async (code: string, name: string) =>
      (await prisma.student.create({ data: { schoolId: A, studentCode: code, displayName: name, accountStatus: "none" }, select: { id: true } })).id;

    const dir = await user("dir.b4@orya.test", "direction", A, "Direction B4");
    await user("dirb.b4@orya.test", "direction", B, "Direction B4 B");
    const parent = await user("parent.b4@orya.test", "parent", A, "Parent B4");
    const parent2 = await user("parent2.b4@orya.test", "parent", A, "Parent2 B4");
    const parent3 = await user("parent3.b4@orya.test", "parent", A, "Parent3 B4");
    const teacher = await user("teacher.b4@orya.test", "teacher", A, "Enseignant B4");
    await user("bus.b4@orya.test", "bus_attendant", A, "Accompagnateur B4");
    await user("orphan.b4@orya.test", "student", A, "Eleve sans fiche B4");

    const s1 = await student("B4E001", "Eleve B4");
    const s2 = await student("B4E002", "Eleve2 B4");
    const s3 = await student("B4E003", "Eleve3 B4");
    await guardianOf(parent.id, "parent.b4@orya.test", "Parent B4", [s1, s3]);
    await guardianOf(parent2.id, "parent2.b4@orya.test", "Parent2 B4", [s3]);
    await guardianOf(parent3.id, "parent3.b4@orya.test", "Parent3 B4", [s2]);

    const year = schoolYearForDate(new Date());
    const classroom = (await prisma.classroom.create({ data: { schoolId: A, name: "B4-5A" }, select: { id: true } })).id;
    await prisma.enrollment.create({ data: { schoolId: A, studentId: s1, classroomId: classroom, schoolYear: year } });
    await prisma.teacherClassroomAssignment.create({ data: { schoolId: A, teacherProfileId: teacher.profileId, classroomId: classroom, schoolYear: year } });
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    await prisma.agendaItem.create({
      data: { schoolId: A, classroomId: classroom, kind: "homework", title: "Devoir B4", date: new Date(today.getTime() + 2 * 86_400_000), schoolYear: year, authorId: dir.id, authorRole: "direction" },
    });
    const session = await prisma.attendanceSession.create({
      data: { schoolId: A, classroomId: classroom, date: new Date(today.getTime() - 86_400_000), slot: "morning", schoolYear: year, status: "closed" },
      select: { id: true },
    });
    await prisma.attendanceRow.create({ data: { schoolId: A, sessionId: session.id, studentId: s1, status: "absent" } });
    // Justificatifs : un du parent (sur s1), un du co-responsable parent2 (sur s3, enfant partage).
    await prisma.absenceJustification.create({
      data: { schoolId: A, studentId: s1, fromDate: today, toDate: today, reason: "Motif parent B4", submittedById: parent.id },
    });
    await prisma.absenceJustification.create({
      data: { schoolId: A, studentId: s3, fromDate: today, toDate: today, reason: "Motif prive parent2 B4", submittedById: parent2.id },
    });
    const body = "Texte de consentement parental v0 FR - fixture bloc 4, tests uniquement.";
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
      JSON.stringify({ s1, s2, s3, textId: text.id, classroomId: classroom, schoolAId: A }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});