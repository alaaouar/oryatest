import { describe, it, expect, vi, beforeEach } from "vitest";
import { TransportEtaService } from "../../src/transport/transport-eta.service";
import { TransportNotificationService, type StudentNotificationTarget } from "../../src/transport/transport-notification.service";

describe("TransportEtaService", () => {
  let etaService: TransportEtaService;

  beforeEach(() => {
    etaService = new TransportEtaService();
  });

  it("calculates accurate Haversine distance between two coordinates in Casablanca", () => {
    // Lycée / École à Gauthier (Casablanca)
    const school = { latitude: 33.5898, longitude: -7.6038 };
    // Arrêt Maârif (environ 2.8 km à vol d'oiseau)
    const stop = { latitude: 33.578, longitude: -7.631 };

    const distance = etaService.haversineDistance(school, stop);
    // Distance attendue ~2800 - 3000 mètres
    expect(distance).toBeGreaterThan(2500);
    expect(distance).toBeLessThan(3200);
  });

  it("computes realistic ETA with urban road detour factor", () => {
    const current = { latitude: 33.585, longitude: -7.615 };
    const stop = { latitude: 33.58, longitude: -7.62 };

    const result = etaService.computeEta(current, stop, 50, 30); // 30 km/h
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.etaMinutes).toBeGreaterThan(0);
    expect(result.isWithinRadius).toBe(false);
  });

  it("detects when bus is within radius of stop (arrival)", () => {
    const current = { latitude: 33.58001, longitude: -7.62001 };
    const stop = { latitude: 33.58, longitude: -7.62 };

    const result = etaService.computeEta(current, stop, 50); // rayon 50m
    expect(result.isWithinRadius).toBe(true);
    expect(result.etaMinutes).toBe(0);
  });

  it("correctly flags 5-minute approaching window without jitter false-positives", () => {
    // Cas 1 : ETA 4 min, 1500m -> OUI
    expect(etaService.isApproachingWithin5Min(4, 1500)).toBe(true);

    // Cas 2 : ETA 1 min, 400m -> OUI
    expect(etaService.isApproachingWithin5Min(1, 400)).toBe(true);

    // Cas 3 : ETA 8 min, 3500m -> NON (trop loin)
    expect(etaService.isApproachingWithin5Min(8, 3500)).toBe(false);

    // Cas 4 : Jitter de vitesse créant une fausse ETA courte mais distance 5 km -> NON
    expect(etaService.isApproachingWithin5Min(4, 5000)).toBe(false);
  });
});

describe("TransportNotificationService — Idempotence & Anti-doublons", () => {
  let notificationService: TransportNotificationService;
  let mockNotificationsService: any;
  let mockTx: any;
  let inMemoryLogs: Map<string, any>;

  beforeEach(() => {
    inMemoryLogs = new Map();

    mockNotificationsService = {
      notifyUsers: vi.fn().mockResolvedValue(1),
    };

    mockTx = {
      transportNotificationLog: {
        findUnique: vi.fn().mockImplementation(({ where }) => {
          const key = `${where.tripId_studentId_notificationType.tripId}_${where.tripId_studentId_notificationType.studentId}_${where.tripId_studentId_notificationType.notificationType}`;
          return Promise.resolve(inMemoryLogs.get(key) ?? null);
        }),
        create: vi.fn().mockImplementation(({ data }) => {
          const key = `${data.tripId}_${data.studentId}_${data.notificationType}`;
          const record = { id: "log-uuid-1", ...data };
          inMemoryLogs.set(key, record);
          return Promise.resolve(record);
        }),
      },
    };

    notificationService = new TransportNotificationService(mockNotificationsService);
  });

  it("sends 5-min notification on first trigger and records in log", async () => {
    const target: StudentNotificationTarget = {
      studentId: "student-1",
      studentName: "Mehdi Benjelloun",
      stopId: "stop-1",
      stopName: "Angle Bd Roudani",
      guardianUserIds: ["parent-user-1"],
    };

    const sent = await notificationService.notifyEta5Minutes(
      mockTx,
      "school-1",
      "trip-1",
      target,
      4,
    );

    expect(sent).toBe(true);
    expect(mockNotificationsService.notifyUsers).toHaveBeenCalledTimes(1);
    expect(mockNotificationsService.notifyUsers).toHaveBeenCalledWith(
      mockTx,
      "school-1",
      ["parent-user-1"],
      expect.objectContaining({
        kind: "transport_eta",
        title: expect.stringContaining("4 min"),
      }),
    );
  });

  it("prevents duplicate notifications if GPS jitters and triggers repeatedly", async () => {
    const target: StudentNotificationTarget = {
      studentId: "student-1",
      studentName: "Mehdi Benjelloun",
      stopId: "stop-1",
      stopName: "Angle Bd Roudani",
      guardianUserIds: ["parent-user-1"],
    };

    // Premier appel (4 min)
    const firstCall = await notificationService.notifyEta5Minutes(
      mockTx,
      "school-1",
      "trip-1",
      target,
      4,
    );
    expect(firstCall).toBe(true);

    // Deuxième appel 5 secondes plus tard avec légère variation (3 min)
    const secondCall = await notificationService.notifyEta5Minutes(
      mockTx,
      "school-1",
      "trip-1",
      target,
      3,
    );
    expect(secondCall).toBe(false);

    // Troisième appel 10 secondes plus tard avec jitter GPS (4 min à nouveau)
    const thirdCall = await notificationService.notifyEta5Minutes(
      mockTx,
      "school-1",
      "trip-1",
      target,
      4,
    );
    expect(thirdCall).toBe(false);

    // Le parent n'a reçu STRICTEMENT qu'une seule notification pour cette tournée
    expect(mockNotificationsService.notifyUsers).toHaveBeenCalledTimes(1);
  });

  it("allows separate arrival notification even after 5-min alert was sent", async () => {
    const target: StudentNotificationTarget = {
      studentId: "student-1",
      studentName: "Mehdi Benjelloun",
      stopId: "stop-1",
      stopName: "Angle Bd Roudani",
      guardianUserIds: ["parent-user-1"],
    };

    // 1. Alerte 5 min
    await notificationService.notifyEta5Minutes(mockTx, "school-1", "trip-1", target, 5);

    // 2. Alerte Arrivé
    const arrivalSent = await notificationService.notifyBusArrivedAtStop(
      mockTx,
      "school-1",
      "trip-1",
      target,
    );
    expect(arrivalSent).toBe(true);

    // 3. Répétition de l'alerte Arrivé bloquée
    const secondArrival = await notificationService.notifyBusArrivedAtStop(
      mockTx,
      "school-1",
      "trip-1",
      target,
    );
    expect(secondArrival).toBe(false);

    expect(mockNotificationsService.notifyUsers).toHaveBeenCalledTimes(2);
  });
});
