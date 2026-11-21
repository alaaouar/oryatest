import { PrismaClient } from "@prisma/client";
import { demoClasses } from "../src/lib/demo-attendance";

const prisma = new PrismaClient();

async function main() {
  const alNour = await prisma.tenant.upsert({
    where: { slug: "al-nour" },
    update: {
      name: "Groupe scolaire Al Nour",
      city: "Casablanca",
    },
    create: {
      slug: "al-nour",
      name: "Groupe scolaire Al Nour",
      city: "Casablanca",
    },
  });

  const alMassar = await prisma.tenant.upsert({
    where: { slug: "al-massar" },
    update: {
      name: "École Al Massar",
      city: "Rabat",
    },
    create: {
      slug: "al-massar",
      name: "École Al Massar",
      city: "Rabat",
    },
  });

  for (const demoClass of demoClasses) {
    const klass = await prisma.class.upsert({
      where: {
        tenantId_name: {
          tenantId: alNour.id,
          name: demoClass.name,
        },
      },
      update: { cycle: demoClass.cycle },
      create: {
        tenantId: alNour.id,
        name: demoClass.name,
        cycle: demoClass.cycle,
      },
    });

    for (const student of demoClass.students) {
      await prisma.student.upsert({
        where: {
          tenantId_code: {
            tenantId: alNour.id,
            code: student.id,
          },
        },
        update: {
          label: student.label,
          classId: klass.id,
        },
        create: {
          tenantId: alNour.id,
          classId: klass.id,
          code: student.id,
          label: student.label,
        },
      });
    }
  }

  const massarClass = await prisma.class.upsert({
    where: {
      tenantId_name: {
        tenantId: alMassar.id,
        name: "5ᵉ A",
      },
    },
    update: { cycle: "Primaire" },
    create: {
      tenantId: alMassar.id,
      name: "5ᵉ A",
      cycle: "Primaire",
    },
  });

  await prisma.student.upsert({
    where: {
      tenantId_code: {
        tenantId: alMassar.id,
        code: "massar-demo-01",
      },
    },
    update: {
      label: "Élève démo Massar 01",
      classId: massarClass.id,
    },
    create: {
      tenantId: alMassar.id,
      classId: massarClass.id,
      code: "massar-demo-01",
      label: "Élève démo Massar 01",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
