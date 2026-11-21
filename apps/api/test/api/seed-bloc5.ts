/**
 * Fixture Bloc 5 (facturation ecole) via DIRECT_DATABASE_URL (orya_owner), base jetable.
 * Mot de passe lu dans ORYA_B5_PASSWORD (genere par le script de test, jamais affiche).
 * Identifiants legaux : aucun (les valeurs emetteur sont les valeurs FICTIVES par defaut).
 * Ne jamais utiliser en production.
 */
import { createHash } from "node:crypto";
import argon2 from "argon2";
import { PrismaClient, type ProfileRole } from "@prisma/client";

const YEAR = "2026-2027";
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL;
  const password = process.env.ORYA_B5_PASSWORD;
  if (!url) throw new Error("DIRECT_DATABASE_URL requise");
  if (!password || password.length < 16) throw new Error("ORYA_B5_PASSWORD requise");
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const school = async (name: string, code: string) => (await prisma.school.create({ data: { name, city: "Rabat", code, status: "active" }, select: { id: true } })).id;
    const A = await school("Ecole B5 A", "B5TSTA");
    const B = await school("Ecole B5 B", "B5TSTB");
    const P: string[] = [];
    for (let i = 1; i <= 5; i += 1) P.push(await school(i === 1 ? "=SUM(1+1) Ecole B5 P1" : `Ecole B5 P${i}`, `B5PAR${i}`));
    async function user(email: string, role: ProfileRole, schoolId: string | null, name: string) {
      const u = await prisma.user.create({ data: { email, passwordHash, status: "active" }, select: { id: true } });
      const p = await prisma.userProfile.create({ data: { userId: u.id, schoolId, role, displayName: name }, select: { id: true } });
      await prisma.user.update({ where: { id: u.id }, data: { activeProfileId: p.id }, select: { id: true } });
      return u.id;
    }
    const superId = await user("super.b5@orya.test", "super_admin", null, "Super B5");
    await user("dir.b5@orya.test", "direction", A, "Direction B5");
    await user("dirb.b5@orya.test", "direction", B, "Direction B5 B");
    await user("dir2.b5@orya.test", "direction", A, "Direction B5 seconde (premiere connexion pendant la suspension)");
    await user("teacher.b5@orya.test", "teacher", A, "Enseignant B5");
    await prisma.subscription.create({ data: { schoolId: A, status: "active" } });

    const classroom = async (schoolId: string) => (await prisma.classroom.create({ data: { schoolId, name: "B5-6A" }, select: { id: true } })).id;
    const cA = await classroom(A);
    const ids: Record<string, string> = {};
    // e1 inscrit toute l'annee | e2 parti AVANT la reference | e3 parti APRES | e4 arrive APRES
    // e5 sans inscription cette annee | e6 arrive LE jour de reference | e7 parti LE jour de reference
    const plan: [string, string | null, string | null, string][] = [
      ["e1", null, null, YEAR], ["e2", null, "2026-10-15", YEAR], ["e3", null, "2026-11-30", YEAR], ["e4", "2026-11-05", null, YEAR],
      ["e5", null, null, "2025-2026"], ["e6", "2026-10-31", null, YEAR], ["e7", null, "2026-10-31", YEAR],
    ];
    for (const [key, startsOn, endsOn, schoolYear] of plan) {
      const s = await prisma.student.create({ data: { schoolId: A, studentCode: `B5${key.toUpperCase()}`, displayName: `Eleve B5 ${key}`, accountStatus: "none" }, select: { id: true } });
      ids[key] = s.id;
      await prisma.enrollment.create({ data: { schoolId: A, studentId: s.id, classroomId: cA, schoolYear, startsOn: startsOn ? d(startsOn) : null, endsOn: endsOn ? d(endsOn) : null } });
    }
    // Exceptions a la suspension (S10-S19) : deux responsables de l'ecole A, consentements actifs
    // sur e1 et e3 (texte valide FICTIF, reference FIXTURE-TEST-ONLY).
    const body = "Texte de consentement FICTIF pour les tests du bloc 5. Non juridique.";
    const text = await prisma.consentText.create({
      data: { purpose: "student_account", version: "b5", locale: "fr", body, bodySha256: createHash("sha256").update(body, "utf8").digest("hex"), status: "validated", effectiveAt: new Date(), legalDocumentRef: "FIXTURE-TEST-ONLY", legalValidatedAt: d("2026-01-01") },
      select: { id: true },
    });
    const parentUser = await user("parent.b5@orya.test", "parent", A, "Parent B5");
    const parent2User = await user("parent2.b5@orya.test", "parent", A, "Parent B5 bis");
    const g1 = (await prisma.guardian.create({ data: { schoolId: A, userId: parentUser, fullName: "Parent B5", email: "parent.b5@orya.test" }, select: { id: true } })).id;
    const g2 = (await prisma.guardian.create({ data: { schoolId: A, userId: parent2User, fullName: "Parent B5 bis", email: "parent2.b5@orya.test" }, select: { id: true } })).id;
    for (const [g, s] of [[g1, ids.e1 as string], [g1, ids.e3 as string], [g2, ids.e6 as string]] as const) {
      await prisma.studentGuardian.create({ data: { schoolId: A, studentId: s, guardianId: g, isPrimary: true } });
    }
    const consent = async (studentId: string, guardianId: string, userId: string) =>
      (await prisma.parentalConsent.create({ data: { schoolId: A, studentId, guardianId, userId, textId: text.id, channel: "web" }, select: { id: true } })).id;
    ids.consentE1 = await consent(ids.e1 as string, g1, parentUser);
    ids.consentE3 = await consent(ids.e3 as string, g1, parentUser);    for (const p of P) {
      const c = await classroom(p);
      const s = await prisma.student.create({ data: { schoolId: p, studentCode: "B5P001", displayName: "Eleve B5 P", accountStatus: "none" }, select: { id: true } });
      await prisma.enrollment.create({ data: { schoolId: p, studentId: s.id, classroomId: c, schoolYear: YEAR } });
    }
    process.stdout.write(JSON.stringify({ A, B, P, superId, ...ids }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});