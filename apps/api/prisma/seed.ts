/**
 * ORYA — seed de recette (Lot 1, CDC §16)
 *
 *   npm run db:seed
 *
 * Produit un jeu de données déterministe et idempotent :
 *   - 3 écoles (2 actives, 1 en attente de validation) ;
 *   - 1 super-admin ORYA ;
 *   - par école : 1 direction, 1 enseignant, 2 parents, 2 élèves ;
 *   - 2 responsables par élève (la limite imposée par la base) ;
 *   - consentements versionnés pour chaque parent.
 *
 * Les identifiants sont fixes : les tests peuvent cibler des UUID connus.
 * Aucune donnée réelle n'est utilisée. Aucune donnée personnelle réelle non plus.
 *
 * Sécurités :
 *   - refuse de s'exécuter si NODE_ENV=production ;
 *   - exige SEED_PASSWORD (aucune valeur par défaut dans le code) ;
 *   - se connecte avec DIRECT_DATABASE_URL (orya_owner), car le RLS bloque
 *     volontairement les écritures sans contexte d'école.
 */
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

function fail(message: string): never {
  console.error(`\n[seed] ${message}\n`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  fail("Le seed de recette est interdit en production.");
}

const seedPassword = process.env.SEED_PASSWORD ?? "";
if (seedPassword.length < 12) {
  fail("SEED_PASSWORD est absente ou trop courte (12 caractères minimum).");
}

const directUrl = process.env.DIRECT_DATABASE_URL ?? "";
if (directUrl.length === 0) {
  fail("DIRECT_DATABASE_URL est absente (rôle orya_owner requis pour le seed).");
}

const prisma = new PrismaClient({ datasourceUrl: directUrl });

/** UUID déterministe : <préfixe>-0000-4000-8000-<compteur> */
function id(prefix: string, counter: number): string {
  return `${prefix}-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

const SCHOOL_IDS = [id("0a000000", 1), id("0a000000", 2), id("0a000000", 3)] as const;

const SCHOOLS = [
  {
    id: SCHOOL_IDS[0],
    name: "École Al Nour",
    city: "Casablanca",
    ice: "ICE-DEMO-001",
    code: "ALNOUR",
    status: "active" as const,
    slug: "ecole-a",
  },
  {
    id: SCHOOL_IDS[1],
    name: "École Al Massar",
    city: "Rabat",
    ice: "ICE-DEMO-002",
    code: "ALMSAR",
    status: "active" as const,
    slug: "ecole-b",
  },
  {
    id: SCHOOL_IDS[2],
    name: "École Ibn Sina",
    city: "Marrakech",
    ice: "ICE-DEMO-003",
    code: "IBNSIN",
    status: "pending" as const,
    slug: "ecole-c",
  },
];

async function main(): Promise<void> {
  console.log("[seed] calcul des empreintes Argon2id…");
  const passwordHash = await argon2.hash(seedPassword, {
    type: argon2.argon2id,
    memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
  });

  // --- écoles -------------------------------------------------------------
  for (const school of SCHOOLS) {
    await prisma.school.upsert({
      where: { id: school.id },
      update: {
        name: school.name,
        city: school.city,
        ice: school.ice,
        code: school.code,
        status: school.status,
      },
      create: {
        id: school.id,
        name: school.name,
        city: school.city,
        ice: school.ice,
        code: school.code,
        status: school.status,
      },
    });
  }

  // --- abonnements : tous en essai (CDC §7, facturation au Lot 6) ----------
  const trialEnd = new Date();
  trialEnd.setFullYear(trialEnd.getFullYear() + 1);

  for (const school of SCHOOLS) {
    await prisma.subscription.upsert({
      where: { schoolId: school.id },
      update: {},
      create: {
        schoolId: school.id,
        status: "trial",
        plan: "standard",
        pricePerChildMad: 120,
        trialEndsAt: trialEnd,
      },
    });
  }
  // --- super-admin ORYA ---------------------------------------------------
  const superAdminId = id("0b000000", 1);
  const superAdminProfileId = id("0c000000", 1);

  await prisma.user.upsert({
    where: { email: "superadmin@orya.test" },
    update: { status: "active" },
    create: {
      id: superAdminId,
      email: "superadmin@orya.test",
      passwordHash,
      locale: "fr",
      status: "active",
    },
  });

  await prisma.userProfile.upsert({
    where: { id: superAdminProfileId },
    update: { displayName: "Super-admin ORYA" },
    create: {
      id: superAdminProfileId,
      userId: superAdminId,
      schoolId: null,
      role: "super_admin",
      displayName: "Super-admin ORYA",
    },
  });

  // Le profil doit exister avant d'être référencé par User.activeProfileId
  // (contrainte de clé étrangère User_activeProfileId_fkey).
  await prisma.user.update({
    where: { id: superAdminId },
    data: { activeProfileId: superAdminProfileId },
  });

  // --- comptes par école --------------------------------------------------
  for (const [index, school] of SCHOOLS.entries()) {
    const base = index + 1;

    const people = [
      {
        counter: 1,
        role: "direction" as const,
        email: `direction@${school.slug}.orya.test`,
        displayName: "Direction",
        schoolId: school.id,
      },
      {
        counter: 2,
        role: "teacher" as const,
        email: `professeur@${school.slug}.orya.test`,
        displayName: "Enseignant",
        schoolId: school.id,
      },
      {
        counter: 3,
        role: "parent" as const,
        email: `parent1@${school.slug}.orya.test`,
        displayName: "Parent un",
        schoolId: school.id,
      },
      {
        counter: 4,
        role: "parent" as const,
        email: `parent2@${school.slug}.orya.test`,
        displayName: "Parent deux",
        schoolId: school.id,
      },
    ];

    const userProfiles: { userId: string; profileId: string; role: string }[] = [];

    for (const person of people) {
      const userId = id("0b000000", base * 10 + person.counter);
      const profileId = id("0c000000", base * 10 + person.counter);

      await prisma.user.upsert({
        where: { email: person.email },
        update: { status: "active" },
        create: {
          id: userId,
          email: person.email,
          passwordHash,
          locale: "fr",
          status: "active",
        },
      });

      await prisma.userProfile.upsert({
        where: { id: profileId },
        update: { displayName: person.displayName },
        create: {
          id: profileId,
          userId,
          schoolId: person.schoolId,
          role: person.role,
          displayName: person.displayName,
        },
      });

      // Après création du profil, jamais avant (contrainte de clé étrangère).
      await prisma.user.update({
        where: { id: userId },
        data: { activeProfileId: profileId },
      });

      userProfiles.push({ userId, profileId, role: person.role });
    }

    // --- élèves -----------------------------------------------------------
    const studentIds: string[] = [];
    for (const studentNumber of [1, 2]) {
      const studentId = id("0d000000", base * 10 + studentNumber);
      studentIds.push(studentId);

      await prisma.student.upsert({
        where: { id: studentId },
        update: { displayName: `Élève démo ${school.slug.toUpperCase()}-${studentNumber}` },
        create: {
          id: studentId,
          schoolId: school.id,
          studentCode: `${school.slug.toUpperCase()}-${String(studentNumber).padStart(3, "0")}`,
          displayName: `Élève démo ${school.slug.toUpperCase()}-${studentNumber}`,
        },
      });
    }

    // --- responsables -----------------------------------------------------
    const parentProfiles = userProfiles.filter((entry) => entry.role === "parent");

    for (const [parentIndex, parent] of parentProfiles.entries()) {
      const guardianId = id("0e000000", base * 10 + parentIndex + 1);

      await prisma.guardian.upsert({
        where: { id: guardianId },
        update: { fullName: `Responsable ${school.slug.toUpperCase()}-${parentIndex + 1}` },
        create: {
          id: guardianId,
          schoolId: school.id,
          userId: parent.userId,
          fullName: `Responsable ${school.slug.toUpperCase()}-${parentIndex + 1}`,
          email:
            parentIndex === 0
              ? `parent1@${school.slug}.orya.test`
              : `parent2@${school.slug}.orya.test`,
        },
      });

      // Deux responsables par élève : exactement la limite autorisée par la base.
      for (const [studentIndex, studentId] of studentIds.entries()) {
        const linkId = id("0f000000", base * 100 + parentIndex * 10 + studentIndex);

        await prisma.studentGuardian.upsert({
          where: { id: linkId },
          update: {},
          create: {
            id: linkId,
            schoolId: school.id,
            studentId,
            guardianId,
            relationship: parentIndex === 0 ? "père" : "mère",
            isPrimary: parentIndex === 0,
          },
        });
      }

      // --- consentements (CDC §9) ----------------------------------------
      for (const [scopeIndex, scope] of (["privacy", "terms"] as const).entries()) {
        const consentId = id("01000000", base * 100 + parentIndex * 10 + scopeIndex);

        await prisma.consent.upsert({
          where: { id: consentId },
          update: {},
          create: {
            id: consentId,
            userId: parent.userId,
            schoolId: school.id,
            scope,
            version: "2026-10-v1",
          },
        });
      }
    }
  }

  const [schools, users, profiles, students, guardians, links, consents] = await Promise.all([
    prisma.school.count(),
    prisma.user.count(),
    prisma.userProfile.count(),
    prisma.student.count(),
    prisma.guardian.count(),
    prisma.studentGuardian.count(),
    prisma.consent.count(),
  ]);

  console.log(
    [
      "[seed] terminé :",
      `${schools} écoles,`,
      `${users} comptes,`,
      `${profiles} profils,`,
      `${students} élèves,`,
      `${guardians} responsables,`,
      `${links} liens élève/responsable,`,
      `${consents} consentements.`,
    ].join(" "),
  );
  console.log("[seed] mot de passe des comptes de démonstration : défini par SEED_PASSWORD (non affiché).");
  console.log("[seed] comptes : superadmin@orya.test, direction@ecole-a.orya.test, etc.");
}

main()
  .catch((error: unknown) => {
    console.error("[seed]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
