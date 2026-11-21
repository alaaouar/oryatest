/**
 * Fixture Bloc 6 (t62u : pre-production et trous connus) via DIRECT_DATABASE_URL (orya_owner),
 * base jetable orya_bloc6. Mot de passe lu dans ORYA_B6_PASSWORD (genere par le script de test,
 * jamais affiche). Donnees FICTIVES de test uniquement. Ne jamais utiliser en production.
 */
import argon2 from "argon2";
import { PrismaClient, type ProfileRole } from "@prisma/client";

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL;
  const password = process.env.ORYA_B6_PASSWORD;
  if (!url) throw new Error("DIRECT_DATABASE_URL requise");
  if (!password || password.length < 16) throw new Error("ORYA_B6_PASSWORD requise");
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const A = (await prisma.school.create({ data: { name: "Ecole B6 A (fictive)", city: "Rabat", code: "B6TSTA", status: "active" }, select: { id: true } })).id;
    await prisma.subscription.create({ data: { schoolId: A, status: "active" } });
    const ids: Record<string, string> = { A };
    async function user(key: string, email: string, role: ProfileRole, schoolId: string | null, name: string) {
      const u = await prisma.user.create({ data: { email, passwordHash, status: "active" }, select: { id: true } });
      const p = await prisma.userProfile.create({ data: { userId: u.id, schoolId, role, displayName: name }, select: { id: true } });
      await prisma.user.update({ where: { id: u.id }, data: { activeProfileId: p.id }, select: { id: true } });
      ids[key] = u.id;
      return u.id;
    }
    const parent = await user("parent", "parent.b6@orya.test", "parent", A, "Parent B6");
    await user("dir", "dir.b6@orya.test", "direction", A, "Direction B6");
    await user("teacher", "teacher.b6@orya.test", "teacher", A, "Enseignant B6");
    // Comptes du test de fumee (B4) : export puis suppression de compte.
    const smokeExport = await user("smokeExport", "smoke.export.b6@orya.test", "parent", A, "Parent fumee export B6");
    const smokeDelete = await user("smokeDelete", "smoke.delete.b6@orya.test", "parent", A, "Parent fumee suppression B6");
    // Comptes du journal WORM (B3) : suppressions anonymisees par le job.
    const worm1 = await user("worm1", "worm1.b6@orya.test", "parent", A, "Parent WORM 1 B6");
    const worm2 = await user("worm2", "worm2.b6@orya.test", "parent", A, "Parent WORM 2 B6");
    const worm3 = await user("worm3", "worm3.b6@orya.test", "parent", A, "Parent WORM 3 B6");
    for (const [uid, email, name] of [[parent, "parent.b6@orya.test", "Parent B6"], [smokeExport, "smoke.export.b6@orya.test", "Parent fumee export B6"], [smokeDelete, "smoke.delete.b6@orya.test", "Parent fumee suppression B6"], [worm1, "worm1.b6@orya.test", "Parent WORM 1 B6"], [worm2, "worm2.b6@orya.test", "Parent WORM 2 B6"], [worm3, "worm3.b6@orya.test", "Parent WORM 3 B6"]] as const) {
      await prisma.guardian.create({ data: { schoolId: A, userId: uid, fullName: name, email }, select: { id: true } });
    }
    process.stdout.write(JSON.stringify(ids));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
