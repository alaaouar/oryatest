/**
 * Fixture Bloc 7 (t74u, ecran direction « Consentements ») : base JETABLE orya_bloc7 uniquement.
 * Deux ecoles (A, B), textes valides via DIRECT_DATABASE_URL (reference FIXTURE-TEST-ONLY),
 * un texte brouillon reference par un consentement (inference « brouillon juridique »),
 * des consentements web actif / retire, papier actif, et un eleve sans consentement.
 * Coordonnees, IP et user-agent volontairement remplis pour verifier qu'ils ne sortent pas.
 * Ne jamais utiliser en production.
 */
import { createHash } from "node:crypto";
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { schoolYearForDate } from "../../src/core/school-year";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error("DIRECT_DATABASE_URL requise");
  const password = `B7-${createHash("sha256").update(String(Date.now()) + Math.random()).digest("hex").slice(0, 20)}-Aa1!`;
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const schoolYear = schoolYearForDate(new Date());
    const A = (await prisma.school.create({ data: { name: "Ecole B7A", city: "Khenifra", code: "B7A", status: "active" }, select: { id: true } })).id;
    const B = (await prisma.school.create({ data: { name: "Ecole B7B", city: "Khenifra", code: "B7B", status: "active" }, select: { id: true } })).id;

    async function user(email: string, role: "direction" | "teacher" | "parent" | "student" | "super_admin", schoolId: string | null, studentId?: string) {
      const u = await prisma.user.create({ data: { email, passwordHash, status: "active" }, select: { id: true } });
      const p = await prisma.userProfile.create({
        data: { userId: u.id, schoolId, role, displayName: email.split("@")[0] ?? email, studentId: studentId ?? null },
        select: { id: true },
      });
      await prisma.user.update({ where: { id: u.id }, data: { activeProfileId: p.id }, select: { id: true } });
      return u.id;
    }
    const student = async (schoolId: string, code: string, name: string, accountStatus: "none" | "active" = "none") =>
      (await prisma.student.create({ data: { schoolId, studentCode: code, displayName: name, accountStatus }, select: { id: true } })).id;

    const text = async (purpose: "student_account" | "transport_alerts", version: string, locale: "fr" | "ar", validated: boolean) => {
      const body = `Texte FICTIF bloc 7 ${purpose} ${version} ${locale} - non juridique, tests uniquement.`;
      return (
        await prisma.consentText.create({
          data: validated
            ? { purpose, version, locale, body, bodySha256: sha(body), status: "validated", effectiveAt: new Date(), legalDocumentRef: "FIXTURE-TEST-ONLY", legalValidatedAt: new Date("2026-01-01T00:00:00.000Z") }
            : { purpose, version, locale, body, bodySha256: sha(body), status: "draft" },
          select: { id: true },
        })
      ).id;
    };
    const textFr = await text("student_account", "v1-b7", "fr", true);
    const textAr = await text("student_account", "v1-b7", "ar", true);
    const draftStudent = await text("student_account", "v0-student-draft-b7", "fr", false);
    const draftTransport = await text("transport_alerts", "v0-draft-b7", "fr", false);

    const c6 = (await prisma.classroom.create({ data: { schoolId: A, name: "6e A B7" }, select: { id: true } })).id;
    const c5 = (await prisma.classroom.create({ data: { schoolId: A, name: "5e B B7" }, select: { id: true } })).id;
    const s1 = await student(A, "B7E001", "Amine B7", "active");
    const s2 = await student(A, "B7E002", "Basma B7", "active");
    const s3 = await student(A, "B7E003", "Chaimae B7");
    const s4 = await student(A, "B7E004", "Driss B7");
    const s5 = await student(A, "B7E005", "Elias B7", "active");
    for (const [s, c] of [[s1, c6], [s2, c6], [s3, c5], [s4, c5]] as const) {
      await prisma.enrollment.create({ data: { schoolId: A, studentId: s, classroomId: c, schoolYear } });
    }
    const zb = await student(B, "B7Z001", "Zineb B7B", "active");

    const dirA = await user("dir.a.b7@orya.test", "direction", A);
    await user("dir.b.b7@orya.test", "direction", B);
    await user("prof.a.b7@orya.test", "teacher", A);
    await user("super.b7@orya.test", "super_admin", null);
    await user("eleve.a.b7@orya.test", "student", A, s2);
    const parentU = await user("parent.a.b7@orya.test", "parent", A);
    const g1 = (
      await prisma.guardian.create({
        data: { schoolId: A, userId: parentU, fullName: "Parent Un B7", email: "parent.a.b7@orya.test", phone: "0611111117", address: "12 rue Fictive B7" },
        select: { id: true },
      })
    ).id;
    const g3 = (await prisma.guardian.create({ data: { schoolId: A, fullName: "Parent Trois B7", email: "parent3.b7@orya.test", phone: "0633333337" }, select: { id: true } })).id;
    await prisma.studentGuardian.create({ data: { schoolId: A, studentId: s1, guardianId: g1, isPrimary: true } });
    await prisma.studentGuardian.create({ data: { schoolId: A, studentId: s3, guardianId: g3, isPrimary: true } });

    const net = { ip: "203.0.113.7", userAgent: "UA-B7-SECRET" };
    await prisma.parentalConsent.create({ data: { schoolId: A, studentId: s1, guardianId: g1, userId: parentU, purpose: "student_account", textId: textFr, channel: "web", ...net } });
    await prisma.parentalConsent.create({
      data: { schoolId: A, studentId: s2, userId: dirA, purpose: "student_account", textId: textFr, channel: "paper_school", guardianName: "Tuteur Papier B7", paperDate: new Date("2026-10-01T00:00:00.000Z"), paperFileReference: "DOS-B7-001", ...net },
    });
    await prisma.parentalConsent.create({
      data: { schoolId: A, studentId: s3, guardianId: g3, purpose: "student_account", textId: textAr, channel: "web", revokedAt: new Date(), ...net },
    });
    // Reference a un brouillon : impossible par l'API (requireValidatedText) ; sert a verifier l'inference.
    await prisma.parentalConsent.create({ data: { schoolId: A, studentId: s5, guardianId: null, guardianName: "Tuteur Brouillon B7", purpose: "student_account", textId: draftStudent, channel: "paper_school", paperDate: new Date("2026-09-15T00:00:00.000Z"), paperFileReference: "DOS-B7-DRAFT" } });
    await prisma.parentalConsent.create({
      data: { schoolId: B, studentId: zb, purpose: "student_account", textId: textFr, channel: "paper_school", guardianName: "Tuteur Ecole B7B", paperDate: new Date("2026-10-02T00:00:00.000Z"), paperFileReference: "DOS-B7B-001" },
    });

    process.stdout.write(
      JSON.stringify({ A, B, s1, s2, s3, s4, s5, zb, textFr, textAr, draftStudent, draftTransport, password }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "seed bloc7 en echec");
  process.exit(1);
});
