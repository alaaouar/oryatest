import { PrismaClient } from "@prisma/client";

const directUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://orya_owner:IFrLw3_m46woLCvI0mWh04Zg@localhost:5432/orya_v2?schema=public";

const prisma = new PrismaClient({ datasourceUrl: directUrl });

async function verify() {
  console.log("=============================================================");
  console.log("  VÉRIFICATION DE LA SIMULATION : GROUPE SCOLAIRE AL ATLAS");
  console.log("=============================================================\n");

  const school = await prisma.school.findFirst({ where: { code: "ATLAS" } });
  if (!school) throw new Error("École ATLAS introuvable");
  console.log(`[1] Établissement vérifié : ${school.name} (${school.city})`);

  // Classes
  const classes = await prisma.classroom.findMany({ where: { schoolId: school.id } });
  console.log(`[2] Classes créées (${classes.length}) :`);
  for (const c of classes) {
    const studentCount = await prisma.enrollment.count({ where: { classroomId: c.id } });
    console.log(`    - ${c.name} (${c.level}) : ${studentCount} élève(s) inscrit(s)`);
  }

  // Équipe pédagogique
  const staff = await prisma.userProfile.findMany({
    where: { schoolId: school.id },
    include: { user: { select: { email: true } } },
  });
  console.log(`\n[3] Équipe pédagogique & Staff (${staff.length}) :`);
  for (const p of staff) {
    console.log(`    - [${p.role.toUpperCase()}] ${p.displayName} <${p.user.email}>`);
  }

  // Élèves et familles
  const students = await prisma.student.findMany({
    where: { schoolId: school.id },
    include: {
      guardians: { include: { guardian: true } },
      enrollments: { include: { classroom: true } },
    },
  });
  console.log(`\n[4] Effectif Élèves & Responsables rattachés (${students.length} élèves) :`);
  for (const s of students) {
    const gList = s.guardians.map((g) => `${g.guardian.fullName} (${g.relationship}, ${g.guardian.phone})`).join(" · ");
    console.log(`    - ${s.displayName} [${s.studentCode} | Massar: ${s.massarCode}] -> ${gList}`);
  }

  // Évaluations & Notes (Power Skills)
  const assessments = await prisma.assessment.findMany({
    where: { schoolId: school.id },
    include: { results: true },
  });
  console.log(`\n[5] Évaluations & Examens simulés (${assessments.length} examens) :`);
  for (const a of assessments) {
    const avg = a.results.length > 0 ? (a.results.reduce((acc, r) => acc + (r.score ?? 0), 0) / a.results.length).toFixed(1) : 0;
    console.log(`    - ${a.subject} : "${a.title}" (Date: ${a.date.toISOString().slice(0, 10)}) -> ${a.results.length} notes saisies, moyenne: ${avg}/${a.maxScore}`);
  }

  // Assiduité
  const sessions = await prisma.attendanceSession.findMany({
    where: { schoolId: school.id },
    include: { rows: true },
  });
  const totalRows = sessions.reduce((acc, s) => acc + s.rows.length, 0);
  const totalPresents = sessions.reduce((acc, s) => acc + s.rows.filter((r) => r.status === "present").length, 0);
  const totalAbsents = sessions.reduce((acc, s) => acc + s.rows.filter((r) => r.status === "absent").length, 0);
  const totalLates = sessions.reduce((acc, s) => acc + s.rows.filter((r) => r.status === "late").length, 0);

  console.log(`\n[6] Relevé d'Assiduité (${sessions.length} séances d'appel complètes) :`);
  console.log(`    - Total marquages d'appel : ${totalRows}`);
  console.log(`    - Présences : ${totalPresents} (${((totalPresents / totalRows) * 100).toFixed(1)}%)`);
  console.log(`    - Absences  : ${totalAbsents}`);
  console.log(`    - Retards   : ${totalLates}`);

  // Justificatifs
  const justifs = await prisma.absenceJustification.findMany({
    where: { schoolId: school.id },
    include: { student: true },
  });
  console.log(`\n[7] Justificatifs médicaux traités (${justifs.length}) :`);
  for (const j of justifs) {
    console.log(`    - Élève : ${j.student.displayName} · Statut : [${j.status.toUpperCase()}] · Motif : "${j.reason}"`);
  }

  // Transport
  const circuits = await prisma.busCircuit.findMany({
    where: { schoolId: school.id },
    include: { stops: true, students: { include: { student: true } } },
  });
  console.log(`\n[8] Transport Scolaire (${circuits.length} circuit(s)) :`);
  for (const ci of circuits) {
    console.log(`    - ${ci.name} : ${ci.stops.length} arrêts, ${ci.students.length} élève(s) inscrit(s)`);
  }

  // Agenda
  const agenda = await prisma.agendaItem.findMany({ where: { schoolId: school.id } });
  console.log(`\n[9] Agenda scolaire & devoirs (${agenda.length} entrées) :`);
  for (const ag of agenda) {
    console.log(`    - [${ag.kind.toUpperCase()}] ${ag.title} (Échéance: ${ag.date.toISOString().slice(0, 10)})`);
  }

  console.log("\n=============================================================");
  console.log("  TOUTES LES FONCTIONNALITÉS SONT ACTIVÉES ET SIMULÉES !");
  console.log("=============================================================\n");
}

verify()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
