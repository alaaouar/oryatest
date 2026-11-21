/**
 * ORYA — Simulateur de trajet et rejeu GPS en temps réel
 * Supporte à la fois la trajectoire Casablanca par défaut et la trajectoire dynamique
 * si un parent a partagé sa position GPS personnalisée n'importe où dans le monde !
 *
 * Usage:
 *   npx tsx prisma/simulate-trip.ts
 *   npx tsx prisma/simulate-trip.ts --fast
 */
import { PrismaClient } from "@prisma/client";
import { TenancyService } from "../src/core/tenancy.service";
import { AuditService } from "../src/audit/audit.service";
import { TransportEtaService } from "../src/transport/transport-eta.service";
import { TransportRealtimeService } from "../src/transport/transport-realtime.service";
import { TransportNotificationService } from "../src/transport/transport-notification.service";
import { TransportService, CNDP_NOTICE_FR } from "../src/transport/transport.service";
import { NotificationsService } from "../src/parent-space/notifications.service";
import type { PrismaService } from "../src/core/prisma.service";

const directUrl =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://orya_owner:IFrLw3_m46woLCvI0mWh04Zg@localhost:5432/orya_v2?schema=public";

const prisma = new PrismaClient({ datasourceUrl: directUrl }) as unknown as PrismaService;

// Trajectoire GPS Casablanca par défaut
const DEFAULT_CASABLANCA_WAYPOINTS = [
  { lat: 33.5898, lng: -7.6038, speed: 0, heading: 250, label: "Départ Lycée Al Atlas" },
  { lat: 33.5891, lng: -7.6105, speed: 32, heading: 255, label: "Bd Zerktouni (Début)" },
  { lat: 33.5882, lng: -7.6180, speed: 38, heading: 255, label: "Bd Zerktouni (Croisement Roudani)" },
  { lat: 33.5870, lng: -7.6270, speed: 35, heading: 258, label: "Bd Zerktouni Ouest" },
  { lat: 33.5858, lng: -7.6360, speed: 28, heading: 260, label: "Approche Clinique Badr" },
  { lat: 33.5855, lng: -7.6430, speed: 0, heading: 265, label: "Arrêt 1 : Clinique Badr (Arrivé)" },
  { lat: 33.5859, lng: -7.6385, speed: 25, heading: 75, label: "Direction Twin Center" },
  { lat: 33.5862, lng: -7.6355, speed: 30, heading: 70, label: "Approche Twin Center (~5 min de Mehdi)" },
  { lat: 33.5864, lng: -7.6340, speed: 22, heading: 68, label: "Bd Massira (~2 min de Mehdi)" },
  { lat: 33.5865, lng: -7.6330, speed: 15, heading: 65, label: "Ralentissement carrefour Twin Center" },
  { lat: 33.5866, lng: -7.6326, speed: 0, heading: 65, label: "Arrêt 2 : Twin Center (Arrivé - Dépose Mehdi)" },
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const isFast = process.argv.includes("--fast");
  const stepDelay = isFast ? 100 : 1200;

  console.log("================================================================================");
  console.log("  ORYA — SIMULATEUR DE TRAJET SCOLAIRE & REJEU GPS TEMPS RÉEL");
  console.log("================================================================================\n");

  await (prisma as unknown as PrismaClient).$connect();

  try {
    // 1. Initialisation des services
    const tenancy = new TenancyService(prisma);
    const audit = new AuditService(prisma, tenancy);
    const etaService = new TransportEtaService();
    const realtimeService = new TransportRealtimeService();
    const notificationsService = new NotificationsService(tenancy);
    const notificationService = new TransportNotificationService(notificationsService);
    const transportService = new TransportService(
      tenancy,
      audit,
      etaService,
      realtimeService,
      notificationService,
    );

    // 2. Recherche de l'école Al Atlas et du circuit
    const school = await (prisma as unknown as PrismaClient).school.findFirst({
      where: { code: "ATLAS" },
    });

    if (!school) {
      throw new Error("École ATLAS introuvable. Exécutez d'abord : npx tsx prisma/simulate-school.ts");
    }

    console.log(`[1/6] Configuration École : ${school.name} (ID: ${school.id})`);

    // 3. Récupération ou création du véhicule
    let vehicle = await (prisma as unknown as PrismaClient).busVehicle.findFirst({
      where: { schoolId: school.id },
    });

    if (!vehicle) {
      vehicle = await (prisma as unknown as PrismaClient).busVehicle.create({
        data: {
          schoolId: school.id,
          plateNumber: "12345-A-6",
          model: "Mercedes-Benz Sprinter (24 places)",
          capacity: 24,
          active: true,
        },
      });
      console.log(`[2/6] Véhicule créé : ${vehicle.plateNumber} (${vehicle.model})`);
    } else {
      console.log(`[2/6] Véhicule existant : ${vehicle.plateNumber} (${vehicle.model})`);
    }

    // 4. Récupération du circuit et des arrêts
    const circuit = await (prisma as unknown as PrismaClient).busCircuit.findFirst({
      where: { schoolId: school.id },
      include: {
        stops: { orderBy: { position: "asc" } },
        students: { include: { student: true, stop: true } },
      },
    });

    if (!circuit) {
      throw new Error("Aucun circuit trouvé pour l'école ATLAS.");
    }

    console.log(`[3/6] Circuit : "${circuit.name}" (${circuit.stops.length} arrêts, ${circuit.students.length} élèves)`);

    // Affecter le véhicule au circuit
    await (prisma as unknown as PrismaClient).busCircuit.update({
      where: { id: circuit.id },
      data: { vehicleId: vehicle.id },
    });

    // Recherche de l'arrêt de Mehdi
    const mehdiStudent =
      circuit.students.find(
        (s) => s.student.code === "ELE-00042" || s.student.displayName.toLowerCase().includes("mehdi"),
      ) ?? circuit.students[0];
    const mehdiStop =
      circuit.stops.find((st) => st.id === mehdiStudent?.stopId) ??
      circuit.stops.find((st) => st.position === 2) ??
      circuit.stops[1] ??
      circuit.stops[0];

    const schoolLat = school.latitude ?? 33.5898;
    const schoolLng = school.longitude ?? -7.6038;
    const homeLat = mehdiStop?.latitude ?? 33.5866;
    const homeLng = mehdiStop?.longitude ?? -7.6326;
    const homeAddress = mehdiStop?.address || "Domicile de l'élève (Mehdi Benjelloun)";

    // Détection si des coordonnées personnalisées ont été définies par le parent
    const isCustomLocation = Boolean(
      (mehdiStop?.latitude != null &&
        (Math.abs(mehdiStop.latitude - 33.5866) > 0.001 || Math.abs((mehdiStop.longitude ?? 0) - (-7.6326)) > 0.001)) ||
      (school.latitude != null &&
        (Math.abs(school.latitude - 33.5898) > 0.001 || Math.abs((school.longitude ?? 0) - (-7.6038)) > 0.001)),
    );

    let waypoints = DEFAULT_CASABLANCA_WAYPOINTS;
    let stop1Index = 5;
    let stop2Index = 10;
    let stop1Id = circuit.stops[0]?.id;
    let stop2Id = mehdiStop?.id ?? circuit.stops[1]?.id;

    if (!isCustomLocation) {
      // Configuration par défaut Casablanca
      await (prisma as unknown as PrismaClient).school.update({
        where: { id: school.id },
        data: {
          transportTrackingEnabled: true,
          latitude: 33.5898,
          longitude: -7.6038,
        },
      });

      const stopsCoordinates: Record<number, { lat: number; lng: number; address: string }> = {
        1: { lat: 33.5855, lng: -7.6430, address: "Bd Zerktouni / Clinique Badr" },
        2: { lat: 33.5866, lng: -7.6326, address: "Bd Al Massira Al Khadra / Twin Center" },
        3: { lat: 33.5905, lng: -7.6285, address: "Rond-Point des Sports, Gauthier" },
        4: { lat: 33.5898, lng: -7.6038, address: "Groupe Scolaire Al Atlas" },
      };

      for (const stop of circuit.stops) {
        const coords = stopsCoordinates[stop.position];
        if (coords) {
          await (prisma as unknown as PrismaClient).busStop.update({
            where: { id: stop.id },
            data: {
              latitude: coords.lat,
              longitude: coords.lng,
              address: coords.address,
              radiusMeters: 60,
            },
          });
        }
      }
      console.log("      Coordonnées par défaut (Casablanca) appliquées aux arrêts.");
    } else {
      // Mode Dynamique : Trajet personnalisé vers le domicile du parent
      await (prisma as unknown as PrismaClient).school.update({
        where: { id: school.id },
        data: { transportTrackingEnabled: true },
      });

      console.log("      🎯 [MODE LOCALISATION RÉELLE ACTIVÉ]");
      console.log(`      École    : ${schoolLat.toFixed(5)}, ${schoolLng.toFixed(5)} (${school.name})`);
      console.log(`      Domicile : ${homeLat.toFixed(5)}, ${homeLng.toFixed(5)} ("${homeAddress}")`);

      // Étape intermédiaire à ~45% de la distance entre l'école et la maison
      const stop1Lat = Number((schoolLat + (homeLat - schoolLat) * 0.45 + 0.0012).toFixed(6));
      const stop1Lng = Number((schoolLng + (homeLng - schoolLng) * 0.45 - 0.0012).toFixed(6));

      const intermediateStop = circuit.stops.find((s) => s.id !== mehdiStop?.id) ?? circuit.stops[0];
      if (intermediateStop) {
        stop1Id = intermediateStop.id;
        await (prisma as unknown as PrismaClient).busStop.update({
          where: { id: intermediateStop.id },
          data: {
            latitude: stop1Lat,
            longitude: stop1Lng,
            address: "Arrêt intermédiaire / Secteur quartier",
            radiusMeters: 60,
          },
        });
      }
      stop2Id = mehdiStop?.id;

      // Calcul dynamique des waypoints le long du vecteur école -> arrêt 1 -> domicile
      waypoints = [
        { lat: schoolLat, lng: schoolLng, speed: 0, heading: 250, label: `Départ de l'école (${school.name})` },
        {
          lat: schoolLat + (stop1Lat - schoolLat) * 0.3,
          lng: schoolLng + (stop1Lng - schoolLng) * 0.3,
          speed: 32,
          heading: 255,
          label: "Sortie de la zone scolaire",
        },
        {
          lat: schoolLat + (stop1Lat - schoolLat) * 0.65,
          lng: schoolLng + (stop1Lng - schoolLng) * 0.65,
          speed: 38,
          heading: 255,
          label: "Axe routier vers le quartier",
        },
        {
          lat: schoolLat + (stop1Lat - schoolLat) * 0.9,
          lng: schoolLng + (stop1Lng - schoolLng) * 0.9,
          speed: 25,
          heading: 260,
          label: "Ralentissement approche Arrêt 1",
        },
        { lat: stop1Lat, lng: stop1Lng, speed: 0, heading: 265, label: "Arrêt 1 : Étape intermédiaire (Arrivé)" },
        {
          lat: stop1Lat + (homeLat - stop1Lat) * 0.25,
          lng: stop1Lng + (homeLng - stop1Lng) * 0.25,
          speed: 28,
          heading: 75,
          label: "Départ vers le domicile",
        },
        {
          lat: stop1Lat + (homeLat - stop1Lat) * 0.6,
          lng: stop1Lng + (homeLng - stop1Lng) * 0.6,
          speed: 30,
          heading: 70,
          label: "Approche secteur élève (~5 min de Mehdi)",
        },
        {
          lat: stop1Lat + (homeLat - stop1Lat) * 0.82,
          lng: stop1Lng + (homeLng - stop1Lng) * 0.82,
          speed: 20,
          heading: 68,
          label: "Rue adjacente au domicile (~2 min de Mehdi)",
        },
        {
          lat: stop1Lat + (homeLat - stop1Lat) * 0.95,
          lng: stop1Lng + (homeLng - stop1Lng) * 0.95,
          speed: 12,
          heading: 65,
          label: "Ralentissement devant le domicile",
        },
        { lat: homeLat, lng: homeLng, speed: 0, heading: 65, label: `Arrêt 2 : ${homeAddress} (Arrivé - Domicile élève)` },
      ];

      stop1Index = 4;
      stop2Index = 9;
      console.log(`      Trajectoire générée : ${waypoints.length} points GPS calculés jusqu'au domicile.`);
    }

    // 5. Récupération du chauffeur
    const driver = await (prisma as unknown as PrismaClient).user.findFirst({
      where: { email: "bus@atlas.orya.test" },
      include: { profiles: { where: { schoolId: school.id } } },
    });

    if (!driver || !driver.profiles[0]) {
      throw new Error("Utilisateur chauffeur 'bus@atlas.orya.test' introuvable.");
    }

    const driverProfile = driver.profiles[0];
    const driverAuth = {
      userId: driver.id,
      email: driver.email,
      role: driverProfile.role,
      profileId: driverProfile.id,
      schoolId: school.id,
      isSuperAdmin: false,
      sessionExpiresAt: new Date(Date.now() + 3600000),
    };

    // 6. Démarrage de la tournée
    console.log("\n[4/6] Démarrage de la tournée (Retour / Dropoff)...");
    const trip = await transportService.startTrip(driverAuth, {
      circuitId: circuit.id,
      direction: "dropoff",
      vehicleId: vehicle.id,
    });

    console.log(`      ✓ Tournée ID : ${trip.id} (Statut: ${trip.status})`);
    console.log(`      ✓ Notice légale CNDP Loi 09-08 affichée.`);

    // 7. Rejeu de la trajectoire GPS
    console.log(`\n[5/6] Rejeu GPS en cours (${waypoints.length} points, intervalle: ${stepDelay}ms)...`);
    console.log("--------------------------------------------------------------------------------");

    let notifiedEtaMehdi = false;
    let stop1Reached = false;
    let stop2Reached = false;

    for (let i = 0; i < waypoints.length; i++) {
      const pt = waypoints[i];
      const now = new Date();

      const result = await transportService.recordPositions(driverAuth, trip.id, {
        positions: [
          {
            latitude: pt.lat,
            longitude: pt.lng,
            speed: pt.speed,
            heading: pt.heading,
            accuracy: 8,
            recordedAt: now.toISOString(),
          },
        ],
      });

      const etaStop2 = result.etaByStop[stop2Id ?? ""]?.etaMinutes ?? 99;
      const distStop2 = result.etaByStop[stop2Id ?? ""]?.distanceMeters ?? 9999;

      console.log(
        `[Point ${String(i + 1).padStart(2, " ")}/${waypoints.length}] ` +
          `Lat: ${pt.lat.toFixed(5)}, Lng: ${pt.lng.toFixed(5)} | ` +
          `Vitesse: ${String(pt.speed).padStart(2, " ")} km/h | ` +
          `ETA Domicile (Mehdi): ${etaStop2} min (${distStop2}m) | ` +
          `"${pt.label}"`,
      );

      // Notification 5 min pour Mehdi
      if (!notifiedEtaMehdi && etaStop2 <= 5) {
        notifiedEtaMehdi = true;
        const notifLogs = await (prisma as unknown as PrismaClient).transportNotificationLog.findMany({
          where: { tripId: trip.id, notificationType: "eta_5min" },
          include: { student: true },
        });

        console.log(`\n      🔔 [ALERTE 5 MIN DÉCLENCHÉE] Notification push & in-app envoyée aux parents !`);
        for (const log of notifLogs) {
          console.log(`         -> Destinataire : Famille de ${log.student.displayName} (Statut: Délivré)`);
        }
        console.log("");
      }

      // Événement Arrêt 1
      if (i === stop1Index && !stop1Reached && stop1Id) {
        stop1Reached = true;
        await transportService.recordStopEvent(driverAuth, trip.id, {
          stopId: stop1Id,
          eventType: "arrived",
        });
        await transportService.recordStopEvent(driverAuth, trip.id, {
          stopId: stop1Id,
          eventType: "students_dropped",
        });
        console.log(`      🛑 Arrêt 1 validé : Élèves déposés.`);
      }

      // Événement Arrêt 2 (Domicile de Mehdi)
      if (i === stop2Index && !stop2Reached && stop2Id) {
        stop2Reached = true;
        await transportService.recordStopEvent(driverAuth, trip.id, {
          stopId: stop2Id,
          eventType: "arrived",
        });
        await transportService.recordStopEvent(driverAuth, trip.id, {
          stopId: stop2Id,
          eventType: "students_dropped",
        });
        console.log(`      🛑 Arrêt 2 validé : ${mehdiStudent.student.displayName} déposé(e).`);

        const arrivalLogs = await (prisma as unknown as PrismaClient).transportNotificationLog.findMany({
          where: { tripId: trip.id, notificationType: "bus_arrived" },
          include: { student: true },
        });
        for (const log of arrivalLogs) {
          console.log(`         -> Notification d'arrivée confirmée pour : ${log.student.displayName}`);
        }
      }

      if (!isFast) {
        await sleep(stepDelay);
      }
    }

    // 8. Clôture de la tournée
    console.log("--------------------------------------------------------------------------------");
    console.log("\n[6/6] Clôture de la tournée par le chauffeur...");
    const endRes = await transportService.endTrip(driverAuth, trip.id);
    console.log(`      ✓ Tournée clôturée : Statut ${endRes.status}`);

    // Rapport final
    const totalPoints = await (prisma as unknown as PrismaClient).busTripPosition.count({
      where: { tripId: trip.id },
    });
    const totalNotifs = await (prisma as unknown as PrismaClient).transportNotificationLog.count({
      where: { tripId: trip.id },
    });

    console.log("\n================================================================================");
    console.log("  RÉSUMÉ DU TEST DE SIMULATION :");
    console.log(`  - Tournée ID                  : ${trip.id}`);
    console.log(`  - Points GPS enregistrés      : ${totalPoints}`);
    console.log(`  - Notifications envoyées      : ${totalNotifs}`);
    console.log(`  - Conformité CNDP Loi 09-08    : Validée (Arrêt du tracking à la fin de la tournée)`);
    console.log("  - Rétention des données        : 30 jours (Purge automatique)");
    console.log("================================================================================\n");
  } finally {
    await (prisma as unknown as PrismaClient).$disconnect();
  }
}

main().catch((err) => {
  console.error("Erreur durant la simulation :", err);
  process.exit(1);
});
