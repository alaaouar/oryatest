/**
 * ORYA — Simulation complète d'établissement scolaire
 * Crée une école marocaine complète (Groupe Scolaire Al Atlas) avec :
 *   - Direction, Enseignants (Maths, PC, Français, Arabe), Accompagnateur bus, Parents, Élèves
 *   - 2 Classes (3ème Année Collège A, Tronc Commun Scientifique)
 *   - Séances d'appel (matin & après-midi) avec présences, retards et absences
 *   - Justificatifs médicaux d'absence validés par la direction
 *   - Évaluations et examens par matière avec notes et commentaires pour les Power Skills
 *   - Circuit de transport scolaire, arrêts et feuilles de route
 *   - Calendrier scolaire et agenda/devoirs
 *   - Contrat et facturation annuelle
 */
import argon2 from "argon2";
import { PrismaClient } from "@prisma/client";

const directUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://orya_owner:IFrLw3_m46woLCvI0mWh04Zg@localhost:5432/orya_v2?schema=public";

const prisma = new PrismaClient({ datasourceUrl: directUrl });

const DEMO_PASSWORD = process.env.SEED_PASSWORD || "Orya2026!AtlasDemo";

function uuid(prefix: string, counter: number): string {
  return `${prefix}-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

async function main() {
  console.log("=============================================================");
  console.log("  ORYA — SIMULATION COMPLÈTE ÉCOLE / ENSEIGNANTS / ÉLÈVES / PARENTS");
  console.log("=============================================================\n");

  console.log("[1/10] Hashage Argon2id du mot de passe partagé...");
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
    timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
    parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
  });

  // --- 1. L'ÉCOLE ---
  const schoolId = uuid("aa000000", 1);
  console.log("[2/10] Création de l'établissement 'Groupe Scolaire Al Atlas'...");
  const school = await prisma.school.upsert({
    where: { id: schoolId },
    update: {
      name: "Groupe Scolaire Al Atlas",
      city: "Casablanca",
      ice: "002489123000045",
      code: "ATLAS",
      status: "active",
    },
    create: {
      id: schoolId,
      name: "Groupe Scolaire Al Atlas",
      city: "Casablanca",
      ice: "002489123000045",
      code: "ATLAS",
      status: "active",
    },
  });

  // Calendrier scolaire
  await prisma.schoolCalendar.upsert({
    where: { schoolId },
    update: { workingDays: [1, 2, 3, 4, 5, 6] },
    create: {
      schoolId,
      workingDays: [1, 2, 3, 4, 5, 6],
    },
  });

  // Contrat & Facturation
  await prisma.schoolContract.upsert({
    where: { schoolId },
    update: { status: "paid" },
    create: {
      schoolId,
      reference: "CTR-2026-ATLAS",
      unitPriceHtMinor: 10000,
      vatRateBp: 2000,
      unitPriceTtcMinor: 12000,
      status: "paid",
    },
  });

  // --- 2. LES CLASSES ---
  console.log("[3/10] Création des classes (3AC-A et TCS-1)...");
  const class3ACId = uuid("aa100000", 1);
  const classTCSId = uuid("aa100000", 2);

  const class3AC = await prisma.classroom.upsert({
    where: { id: class3ACId },
    update: { name: "3ème Année Collège A" },
    create: {
      id: class3ACId,
      schoolId,
      name: "3ème Année Collège A",
      cycle: "Collège",
      level: "3AC",
    },
  });

  const classTCS = await prisma.classroom.upsert({
    where: { id: classTCSId },
    update: { name: "Tronc Commun Scientifique 1" },
    create: {
      id: classTCSId,
      schoolId,
      name: "Tronc Commun Scientifique 1",
      cycle: "Lycée",
      level: "TCS",
    },
  });

  // --- 3. DIRECTION & ENSEIGNANTS ---
  console.log("[4/10] Création des comptes pédagogiques (Direction & Professeurs)...");
  const staff = [
    {
      userId: uuid("aa200000", 1),
      profileId: uuid("aa300000", 1),
      email: "direction@atlas.orya.test",
      displayName: "M. Karim Alami (Directeur)",
      role: "direction" as const,
    },
    {
      userId: uuid("aa200000", 2),
      profileId: uuid("aa300000", 2),
      email: "prof.maths@atlas.orya.test",
      displayName: "Mme Fatima Zahra Bennani (Maths)",
      role: "teacher" as const,
      assignTo: [class3ACId, classTCSId],
    },
    {
      userId: uuid("aa200000", 3),
      profileId: uuid("aa300000", 3),
      email: "prof.pc@atlas.orya.test",
      displayName: "M. Rachid Tazi (Physique-Chimie)",
      role: "teacher" as const,
      assignTo: [class3ACId, classTCSId],
    },
    {
      userId: uuid("aa200000", 4),
      profileId: uuid("aa300000", 4),
      email: "prof.francais@atlas.orya.test",
      displayName: "Mme Leila Mansouri (Français)",
      role: "teacher" as const,
      assignTo: [class3ACId],
    },
    {
      userId: uuid("aa200000", 5),
      profileId: uuid("aa300000", 5),
      email: "prof.arabe@atlas.orya.test",
      displayName: "M. Ahmed Berrada (Langue Arabe)",
      role: "teacher" as const,
      assignTo: [class3ACId],
    },
    {
      userId: uuid("aa200000", 6),
      profileId: uuid("aa300000", 6),
      email: "bus@atlas.orya.test",
      displayName: "M. Hassan Chraibi (Accompagnateur Bus)",
      role: "bus_attendant" as const,
    },
  ];

  for (const p of staff) {
    await prisma.user.upsert({
      where: { email: p.email },
      update: { status: "active", passwordHash },
      create: {
        id: p.userId,
        email: p.email,
        passwordHash,
        locale: "fr",
        status: "active",
      },
    });

    await prisma.userProfile.upsert({
      where: { id: p.profileId },
      update: { displayName: p.displayName },
      create: {
        id: p.profileId,
        userId: p.userId,
        schoolId,
        role: p.role,
        displayName: p.displayName,
      },
    });

    await prisma.user.update({
      where: { id: p.userId },
      data: { activeProfileId: p.profileId },
    });

    if ("assignTo" in p && p.assignTo) {
      for (const cId of p.assignTo) {
        await prisma.teacherClassroomAssignment.upsert({
          where: {
            schoolId_teacherProfileId_classroomId_schoolYear: {
              schoolId,
              teacherProfileId: p.profileId,
              classroomId: cId,
              schoolYear: "2026-2027",
            },
          },
          update: {},
          create: {
            schoolId,
            teacherProfileId: p.profileId,
            classroomId: cId,
            schoolYear: "2026-2027",
          },
        });
      }
    }
  }

  // --- 4. ÉLÈVES & FAMILLES ---
  console.log("[5/10] Création des élèves et des comptes parents...");
  const studentsData = [
    {
      studentId: uuid("aa400000", 1),
      code: "ATL-001",
      massar: "M13489021",
      name: "Mehdi Benjelloun",
      birthDate: new Date("2011-04-12"),
      classId: class3ACId,
      guardians: [
        {
          id: uuid("aa500000", 1),
          userId: uuid("aa600000", 1),
          profileId: uuid("aa700000", 1),
          name: "M. Tariq Benjelloun",
          rel: "père",
          phone: "+212 661-234567",
          email: "parent.benjelloun@atlas.orya.test",
          primary: true,
        },
        {
          id: uuid("aa500000", 2),
          name: "Mme Soraya Benjelloun",
          rel: "mère",
          phone: "+212 662-890123",
          email: "soraya.benjelloun@gmail.com",
          primary: false,
        },
      ],
    },
    {
      studentId: uuid("aa400000", 2),
      code: "ATL-002",
      massar: "M13489022",
      name: "Salma El Fassi",
      birthDate: new Date("2011-06-25"),
      classId: class3ACId,
      guardians: [
        {
          id: uuid("aa500000", 3),
          userId: uuid("aa600000", 2),
          profileId: uuid("aa700000", 2),
          name: "Mme Ghita El Fassi",
          rel: "mère",
          phone: "+212 661-889900",
          email: "parent.elfassi@atlas.orya.test",
          primary: true,
        },
      ],
    },
    {
      studentId: uuid("aa400000", 3),
      code: "ATL-003",
      massar: "M13489023",
      name: "Youssef Amrani",
      birthDate: new Date("2011-01-18"),
      classId: class3ACId,
      guardians: [
        {
          id: uuid("aa500000", 4),
          name: "M. Adil Amrani",
          rel: "père",
          phone: "+212 663-112233",
          email: "parent.amrani@atlas.orya.test",
          primary: true,
        },
      ],
    },
    {
      studentId: uuid("aa400000", 4),
      code: "ATL-004",
      massar: "M13489024",
      name: "Amina Tazi",
      birthDate: new Date("2011-09-03"),
      classId: class3ACId,
      guardians: [
        {
          id: uuid("aa500000", 5),
          name: "Mme Zineb Tazi",
          rel: "mère",
          phone: "+212 661-445566",
          email: "parent.tazi@atlas.orya.test",
          primary: true,
        },
      ],
    },
    {
      studentId: uuid("aa400000", 5),
      code: "ATL-005",
      massar: "M13489025",
      name: "Omar Chraibi",
      birthDate: new Date("2011-11-14"),
      classId: class3ACId,
      guardians: [
        {
          id: uuid("aa500000", 6),
          name: "M. Nabil Chraibi",
          rel: "père",
          phone: "+212 664-556677",
          email: "parent.chraibi@atlas.orya.test",
          primary: true,
        },
      ],
    },
    {
      studentId: uuid("aa400000", 6),
      code: "ATL-006",
      massar: "M13489026",
      name: "Kenza Berrada",
      birthDate: new Date("2011-03-30"),
      classId: class3ACId,
      guardians: [
        {
          id: uuid("aa500000", 7),
          name: "Mme Latifa Berrada",
          rel: "mère",
          phone: "+212 662-778899",
          email: "parent.berrada@atlas.orya.test",
          primary: true,
        },
      ],
    },
    {
      studentId: uuid("aa400000", 7),
      code: "ATL-007",
      massar: "M13489027",
      name: "Hamza Idrissi",
      birthDate: new Date("2010-08-20"),
      classId: classTCSId,
      guardians: [
        {
          id: uuid("aa500000", 8),
          name: "M. Reda Idrissi",
          rel: "père",
          phone: "+212 661-332211",
          email: "parent.idrissi@atlas.orya.test",
          primary: true,
        },
      ],
    },
  ];

  for (const s of studentsData) {
    await prisma.student.upsert({
      where: { id: s.studentId },
      update: {
        displayName: s.name,
        studentCode: s.code,
        massarCode: s.massar,
        birthDate: s.birthDate,
      },
      create: {
        id: s.studentId,
        schoolId,
        studentCode: s.code,
        massarCode: s.massar,
        displayName: s.name,
        birthDate: s.birthDate,
      },
    });

    await prisma.enrollment.upsert({
      where: {
        studentId_schoolYear: {
          studentId: s.studentId,
          schoolYear: "2026-2027",
        },
      },
      update: {},
      create: {
        schoolId,
        studentId: s.studentId,
        classroomId: s.classId,
        schoolYear: "2026-2027",
      },
    });

    for (const g of s.guardians) {
      if ("userId" in g && g.userId && g.email) {
        await prisma.user.upsert({
          where: { email: g.email },
          update: { status: "active", passwordHash },
          create: {
            id: g.userId,
            email: g.email,
            passwordHash,
            locale: "fr",
            status: "active",
          },
        });

        await prisma.userProfile.upsert({
          where: { id: g.profileId! },
          update: { displayName: g.name },
          create: {
            id: g.profileId!,
            userId: g.userId,
            schoolId,
            role: "parent",
            displayName: g.name,
          },
        });

        await prisma.user.update({
          where: { id: g.userId },
          data: { activeProfileId: g.profileId! },
        });
      }

      await prisma.guardian.upsert({
        where: { id: g.id },
        update: {
          fullName: g.name,
          phone: g.phone,
          email: g.email,
        },
        create: {
          id: g.id,
          schoolId,
          userId: "userId" in g ? g.userId : null,
          fullName: g.name,
          phone: g.phone,
          email: g.email,
          address: "24, Boulevard d'Anfa, Résidence Les Palmiers, Casablanca",
        },
      });

      await prisma.studentGuardian.upsert({
        where: {
          studentId_guardianId: {
            studentId: s.studentId,
            guardianId: g.id,
          },
        },
        update: {},
        create: {
          id: g.id,
          schoolId,
          studentId: s.studentId,
          guardianId: g.id,
          relationship: g.rel,
          isPrimary: g.primary,
        },
      });
    }
  }

  // --- 5. ÉVALUATIONS ET EXAMS POUR LES POWER SKILLS ---
  console.log("[6/10] Simulation des examens, notes et Power Skills...");
  const profMathsId = uuid("aa300000", 2);
  const profPCId = uuid("aa300000", 3);
  const profFrId = uuid("aa300000", 4);
  const profArId = uuid("aa300000", 5);

  const assessmentsData = [
    {
      id: uuid("aa800000", 1),
      subject: "Mathématiques",
      title: "Contrôle n°1 : Algèbre & Calcul littéral",
      date: new Date("2026-10-18"),
      maxScore: 20,
      teacherId: profMathsId,
      scores: [
        { studentId: uuid("aa400000", 1), score: 18.5, comment: "Excellente rigueur logique et méthode irréprochable" },
        { studentId: uuid("aa400000", 2), score: 16.0, comment: "Très bon travail, calculs soignés" },
        { studentId: uuid("aa400000", 3), score: 14.5, comment: "Bonne compréhension globale" },
        { studentId: uuid("aa400000", 4), score: 13.0, comment: "Travail sérieux, attention aux erreurs d'étourderie" },
        { studentId: uuid("aa400000", 5), score: 15.5, comment: "Bonne démonstration géométrique" },
        { studentId: uuid("aa400000", 6), score: 17.5, comment: "Très grande aisance dans les résolutions" },
      ],
    },
    {
      id: uuid("aa800000", 2),
      subject: "Mathématiques",
      title: "Contrôle n°2 : Géométrie & Théorème de Thalès",
      date: new Date("2026-11-04"),
      maxScore: 20,
      teacherId: profMathsId,
      scores: [
        { studentId: uuid("aa400000", 1), score: 19.0, comment: "Parfait. Démonstrations limpides et précises" },
        { studentId: uuid("aa400000", 2), score: 17.0, comment: "Très belle progression" },
        { studentId: uuid("aa400000", 3), score: 13.5, comment: "Bons théorèmes, soigner la rédaction" },
        { studentId: uuid("aa400000", 4), score: 14.0, comment: "Bien compris" },
        { studentId: uuid("aa400000", 5), score: 16.0, comment: "Raisonnement structuré" },
        { studentId: uuid("aa400000", 6), score: 18.0, comment: "Remarquable intuition spatiale" },
      ],
    },
    {
      id: uuid("aa800000", 3),
      subject: "Physique-Chimie",
      title: "Évaluation : Mécanique & Forces d'interaction",
      date: new Date("2026-10-25"),
      maxScore: 20,
      teacherId: profPCId,
      scores: [
        { studentId: uuid("aa400000", 1), score: 17.0, comment: "Compréhension fine des concepts et formules" },
        { studentId: uuid("aa400000", 2), score: 16.5, comment: "Très bonne analyse scientifique" },
        { studentId: uuid("aa400000", 3), score: 12.0, comment: "Revoir les unités du système international" },
        { studentId: uuid("aa400000", 4), score: 15.0, comment: "Bon devoir de physique" },
        { studentId: uuid("aa400000", 5), score: 14.5, comment: "Régulier et attentif" },
        { studentId: uuid("aa400000", 6), score: 16.0, comment: "Très bons résultats d'expérimentation" },
      ],
    },
    {
      id: uuid("aa800000", 4),
      subject: "Langue Arabe",
      title: "Compréhension & Analyse littéraire",
      date: new Date("2026-10-29"),
      maxScore: 20,
      teacherId: profArId,
      scores: [
        { studentId: uuid("aa400000", 1), score: 16.5, comment: "Vocabulaire riche, argumentation solide et structurée" },
        { studentId: uuid("aa400000", 2), score: 18.0, comment: "Excellence littéraire et style très soigné" },
        { studentId: uuid("aa400000", 3), score: 14.0, comment: "Bonne compréhension générale" },
        { studentId: uuid("aa400000", 4), score: 15.5, comment: "Analyse fine du texte" },
        { studentId: uuid("aa400000", 5), score: 13.5, comment: "Effort d'écriture apprécié" },
        { studentId: uuid("aa400000", 6), score: 17.0, comment: "Brillante participation et écriture fluide" },
      ],
    },
    {
      id: uuid("aa800000", 5),
      subject: "Français",
      title: "Production écrite argumentative",
      date: new Date("2026-11-08"),
      maxScore: 20,
      teacherId: profFrId,
      scores: [
        { studentId: uuid("aa400000", 1), score: 15.0, comment: "Idées claires et argumentées, surveiller quelques accords" },
        { studentId: uuid("aa400000", 2), score: 17.5, comment: "Très belle plume, nuances d'expression parfaites" },
        { studentId: uuid("aa400000", 3), score: 13.0, comment: "Bon plan, développer les exemples" },
        { studentId: uuid("aa400000", 4), score: 16.0, comment: "Grande clarté syntaxique" },
        { studentId: uuid("aa400000", 5), score: 14.0, comment: "Argumentation correcte" },
        { studentId: uuid("aa400000", 6), score: 16.5, comment: "Aisance d'expression et vocabulaire riche" },
      ],
    },
  ];

  for (const a of assessmentsData) {
    await prisma.assessment.upsert({
      where: { id: a.id },
      update: {
        title: a.title,
        publishedAt: new Date(),
      },
      create: {
        id: a.id,
        schoolId,
        classroomId: class3ACId,
        schoolYear: "2026-2027",
        subject: a.subject,
        title: a.title,
        date: a.date,
        maxScore: a.maxScore,
        createdById: a.teacherId,
        publishedAt: new Date(),
        publishedById: a.teacherId,
      },
    });

    for (const sc of a.scores) {
      await prisma.assessmentResult.upsert({
        where: {
          assessmentId_studentId: {
            assessmentId: a.id,
            studentId: sc.studentId,
          },
        },
        update: {
          score: sc.score,
          comment: sc.comment,
        },
        create: {
          schoolId,
          assessmentId: a.id,
          studentId: sc.studentId,
          score: sc.score,
          absent: false,
          comment: sc.comment,
        },
      });
    }
  }

  // --- 6. SÉANCES D'APPEL & ASSIDUITÉ ---
  console.log("[7/10] Simulation des séances d'appel de classe et d'assiduité...");
  const dates = [
    { date: new Date("2026-11-10"), slot: "morning" as const },
    { date: new Date("2026-11-10"), slot: "afternoon" as const },
    { date: new Date("2026-11-11"), slot: "morning" as const },
    { date: new Date("2026-11-11"), slot: "afternoon" as const },
    { date: new Date("2026-11-12"), slot: "morning" as const },
    { date: new Date("2026-11-12"), slot: "afternoon" as const },
    { date: new Date("2026-11-13"), slot: "morning" as const },
    { date: new Date("2026-11-13"), slot: "afternoon" as const },
    { date: new Date("2026-11-14"), slot: "morning" as const },
  ];

  for (const [idx, s] of dates.entries()) {
    const sessionId = uuid("aa900000", idx + 1);

    await prisma.attendanceSession.upsert({
      where: {
        schoolId_classroomId_date_slot: {
          schoolId,
          classroomId: class3ACId,
          date: s.date,
          slot: s.slot,
        },
      },
      update: { status: "closed" },
      create: {
        id: sessionId,
        schoolId,
        classroomId: class3ACId,
        date: s.date,
        slot: s.slot,
        status: "closed",
        schoolYear: "2026-2027",
        closedAt: new Date(s.date.getTime() + 4 * 3600 * 1000),
        closedById: profMathsId,
      },
    });

    // Lignes de présence
    for (let stIdx = 1; stIdx <= 6; stIdx++) {
      const stId = uuid("aa400000", stIdx);
      let status: "present" | "absent" | "late" = "present";

      // Simulation de cas d'absences et de retards réalistes
      if (stIdx === 3 && (idx === 4 || idx === 5)) {
        status = "absent"; // Youssef absent le 12/11
      } else if (stIdx === 4 && idx === 2) {
        status = "late"; // Amina retard le 11/11 matin
      } else if (stIdx === 1 && idx === 6) {
        status = "late"; // Mehdi 1 retard ponctuel
      }

      await prisma.attendanceRow.upsert({
        where: {
          sessionId_studentId: {
            sessionId,
            studentId: stId,
          },
        },
        update: { status },
        create: {
          id: uuid("ab000000", idx * 10 + stIdx),
          schoolId,
          sessionId,
          studentId: stId,
          status,
        },
      });
    }
  }

  // --- 7. JUSTIFICATIF MÉDICAL VALIDÉ ---
  console.log("[8/10] Dépôt d'un justificatif médical d'absence validé par la direction...");
  const justifId = uuid("ab100000", 1);
  await prisma.absenceJustification.upsert({
    where: { id: justifId },
    update: { status: "accepted" },
    create: {
      id: justifId,
      schoolId,
      studentId: uuid("aa400000", 3), // Youssef Amrani
      fromDate: new Date("2026-11-12"),
      toDate: new Date("2026-11-12"),
      reason: "Consultation médicale pédiatrique pour rhinopharyngite aiguë et repos prescrit.",
      status: "accepted",
      submittedById: uuid("aa200000", 1),
      reviewedById: uuid("aa300000", 1),
      reviewedAt: new Date("2026-11-13"),
      reviewNote: "Certificat médical du Dr. Benmoussa vérifié et validé par la direction.",
    },
  });

  // --- 8. TRANSPORT SCOLAIRE ---
  console.log("[9/10] Création des circuits de bus scolaire et affectation des arrêts...");
  const circuitId = uuid("ab200000", 1);
  const busAttendantProfileId = uuid("aa300000", 6);

  await prisma.busCircuit.upsert({
    where: { schoolId_name: { schoolId, name: "Circuit Al Atlas - Maarif & Gauthier" } },
    update: { attendantProfileId: busAttendantProfileId },
    create: {
      id: circuitId,
      schoolId,
      name: "Circuit Al Atlas - Maarif & Gauthier",
      attendantProfileId: busAttendantProfileId,
      active: true,
    },
  });

  const stops = [
    { id: uuid("ab300000", 1), name: "Arrêt 1 : Bd Zerktouni (Clinique Badr)", position: 1 },
    { id: uuid("ab300000", 2), name: "Arrêt 2 : Twin Center / Bd Massira", position: 2 },
    { id: uuid("ab300000", 3), name: "Arrêt 3 : Rond-Point des Sports (Gauthier)", position: 3 },
    { id: uuid("ab300000", 4), name: "Arrêt 4 : Arrivée Établissement Al Atlas", position: 4 },
  ];

  for (const st of stops) {
    await prisma.busStop.upsert({
      where: { circuitId_position: { circuitId, position: st.position } },
      update: { name: st.name },
      create: {
        id: st.id,
        schoolId,
        circuitId,
        name: st.name,
        position: st.position,
      },
    });
  }

  // Affectation de Mehdi au circuit
  await prisma.busCircuitStudent.upsert({
    where: {
      studentId: uuid("aa400000", 1),
    },
    update: {},
    create: {
      circuitId,
      schoolId,
      studentId: uuid("aa400000", 1),
      stopId: stops[1].id,
    },
  });

  // --- 9. AGENDA & DEVOIRS ---
  console.log("[10/10] Publication des devoirs et événements dans l'agenda de classe...");
  await prisma.agendaItem.upsert({
    where: { id: uuid("ab400000", 1) },
    update: {},
    create: {
      id: uuid("ab400000", 1),
      schoolId,
      classroomId: class3ACId,
      kind: "homework",
      title: "Exercices d'Algèbre (Fiche n°4 - Ex 12 à 18)",
      description: "À rédiger sur le cahier d'exercices. Rigueur exigée dans la démonstration.",
      date: new Date("2026-11-20"),
      schoolYear: "2026-2027",
      authorId: profMathsId,
      authorRole: "teacher",
    },
  });

  await prisma.agendaItem.upsert({
    where: { id: uuid("ab400000", 2) },
    update: {},
    create: {
      id: uuid("ab400000", 2),
      schoolId,
      classroomId: class3ACId,
      kind: "test",
      title: "Devoir surveillé de Physique-Chimie (Énergie & Puissance)",
      description: "Calculatrice scientifique autorisée. Durée : 1h30.",
      date: new Date("2026-11-24"),
      schoolYear: "2026-2027",
      authorId: profPCId,
      authorRole: "teacher",
    },
  });

  console.log("\n=============================================================");
  console.log("  ✅ SIMULATION RÉUSSIE AVEC SUCCÈS !");
  console.log("=============================================================");
  console.log("Établissement : Groupe Scolaire Al Atlas (Casablanca)");
  console.log(`Mot de passe commun : ${DEMO_PASSWORD}\n`);
  console.log("COMPTES DE DÉMONSTRATION DISPONIBLES :");
  console.log("-------------------------------------------------------------");
  console.log("👑 DIRECTION :     direction@atlas.orya.test");
  console.log("📐 PROF MATHS :   prof.maths@atlas.orya.test");
  console.log("⚡ PROF PHYSIQUE: prof.pc@atlas.orya.test");
  console.log("📖 PROF FRANÇAIS: prof.francais@atlas.orya.test");
  console.log("🕌 PROF ARABE:    prof.arabe@atlas.orya.test");
  console.log("🚌 ACCOMPAGNATEUR:bus@atlas.orya.test");
  console.log("👨‍👩‍👧 PARENT ÉLÈVE:  parent.benjelloun@atlas.orya.test (Parent de Mehdi Benjelloun)");
  console.log("-------------------------------------------------------------");
  console.log(`URL de la console : http://localhost:3000/login`);
  console.log(`Fiche de Mehdi Benjelloun : http://localhost:3000/students/${uuid("aa400000", 1)}`);
  console.log("=============================================================\n");
}

main()
  .catch((err) => {
    console.error("Erreur de simulation :", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
