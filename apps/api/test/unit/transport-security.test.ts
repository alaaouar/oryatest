import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForbiddenException, BadRequestException } from "@nestjs/common";
import { TransportService, CNDP_NOTICE_FR } from "../../src/transport/transport.service";
import type { AuthContext } from "../../src/auth/auth.types";

describe("TransportService — Sécurité, CNDP Loi 09-08 et Contrôle d'accès", () => {
  let transportService: TransportService;
  let mockTenancy: any;
  let mockAudit: any;
  let mockEtaService: any;
  let mockRealtimeService: any;
  let mockNotificationService: any;
  let mockTx: any;

  const schoolId = "school-casablanca-1";
  const driverProfileId = "driver-profile-1";
  const otherDriverProfileId = "driver-profile-2";
  const parentUserId = "parent-user-1";
  const strangerParentUserId = "stranger-user-9";
  const studentId = "student-mehdi-1";

  const driverAuth: AuthContext = {
    userId: "user-driver-1",
    email: "bus@atlas.orya.test",
    role: "chauffeur",
    profileId: driverProfileId,
    schoolId,
    isSuperAdmin: false,
    sessionExpiresAt: new Date(Date.now() + 3600000),
  };

  const otherDriverAuth: AuthContext = {
    userId: "user-driver-2",
    email: "otherbus@atlas.orya.test",
    role: "chauffeur",
    profileId: otherDriverProfileId,
    schoolId,
    isSuperAdmin: false,
    sessionExpiresAt: new Date(Date.now() + 3600000),
  };

  const teacherAuth: AuthContext = {
    userId: "user-teacher-1",
    email: "prof@atlas.orya.test",
    role: "enseignant",
    profileId: "teacher-profile-1",
    schoolId,
    isSuperAdmin: false,
    sessionExpiresAt: new Date(Date.now() + 3600000),
  };

  const parentAuth: AuthContext = {
    userId: parentUserId,
    email: "parent@atlas.orya.test",
    role: "parent",
    profileId: "parent-profile-1",
    schoolId,
    isSuperAdmin: false,
    sessionExpiresAt: new Date(Date.now() + 3600000),
  };

  beforeEach(() => {
    mockTx = {
      school: {
        findUnique: vi.fn().mockResolvedValue({
          id: schoolId,
          name: "Groupe Scolaire Al Atlas",
          latitude: 33.5898,
          longitude: -7.6038,
        }),
      },
      busCircuit: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      busStop: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      guardian: {
        update: vi.fn(),
      },
      busTrip: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      busTripPosition: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 42 }),
      },
      busTripStopEvent: {
        create: vi.fn(),
      },
      studentGuardian: {
        findFirst: vi.fn(),
      },
      busCircuitStudent: {
        findUnique: vi.fn(),
      },
      busVehicle: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    mockTenancy = {
      run: vi.fn().mockImplementation((_ctx, callback) => callback(mockTx)),
    };

    mockAudit = {
      scoped: vi.fn().mockResolvedValue(undefined),
    };

    mockEtaService = {
      computeEta: vi.fn().mockReturnValue({ etaMinutes: 4, distanceMeters: 1200, isWithinRadius: false }),
      isApproachingWithin5Min: vi.fn().mockReturnValue(true),
    };

    mockRealtimeService = {
      broadcastTripUpdate: vi.fn(),
      closeTripStream: vi.fn(),
    };

    mockNotificationService = {
      notifyEta5Minutes: vi.fn().mockResolvedValue(true),
      notifyBusArrivedAtStop: vi.fn().mockResolvedValue(true),
    };

    transportService = new TransportService(
      mockTenancy,
      mockAudit,
      mockEtaService,
      mockRealtimeService,
      mockNotificationService,
    );
  });

  describe("Conformité CNDP Loi 09-08", () => {
    it("fournit la notice d'information obligatoire en Français et en Arabe avec rétention 30 jours", () => {
      const notice = transportService.getLegalNotice();
      expect(notice.retentionDays).toBe(30);
      expect(notice.fr).toContain("loi n° 09-08");
      expect(notice.fr).toContain("30 jours");
      expect(notice.ar).toContain("09-08");
    });

    it("exécute la purge automatique des points GPS de plus de 30 jours", async () => {
      const deletedCount = await transportService.cleanupOldPositions();
      expect(deletedCount).toBe(42);
      expect(mockTx.busTripPosition.deleteMany).toHaveBeenCalledWith({
        where: {
          recordedAt: {
            lt: expect.any(Date),
          },
        },
      });
    });
  });

  describe("Contrôle d'accès et Rôles Chauffeur", () => {
    it("interdit à un enseignant ou parent de démarrer une tournée", async () => {
      await expect(
        transportService.startTrip(teacherAuth, {
          circuitId: "circuit-1",
          direction: "dropoff",
        }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        transportService.startTrip(parentAuth, {
          circuitId: "circuit-1",
          direction: "dropoff",
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("bloque l'ingestion de coordonnées GPS si la tournée n'est pas en cours (Principe de finalité CNDP)", async () => {
      mockTx.busTrip.findFirst.mockResolvedValue({
        id: "trip-1",
        schoolId,
        driverProfileId,
        status: "completed",
      });

      await expect(
        transportService.recordPositions(driverAuth, "trip-1", {
          positions: [{ latitude: 33.58, longitude: -7.62 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("interdit à un autre chauffeur de soumettre des coordonnées sur la tournée d'un confrère", async () => {
      mockTx.busTrip.findFirst.mockResolvedValue({
        id: "trip-1",
        schoolId,
        driverProfileId: driverProfileId,
        status: "in_progress",
        circuit: { stops: [] },
      });

      await expect(
        transportService.recordPositions(otherDriverAuth, "trip-1", {
          positions: [{ latitude: 33.58, longitude: -7.62 }],
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe("Sécurité Espace Parent et Minimisation des Données", () => {
    it("interdit à un utilisateur non parent de l'élève d'accéder au suivi", async () => {
      mockTx.studentGuardian.findFirst.mockResolvedValue(null);

      const strangerAuth: AuthContext = {
        ...parentAuth,
        userId: strangerParentUserId,
      };

      await expect(
        transportService.getParentChildTrip(strangerAuth, studentId),
      ).rejects.toThrow(ForbiddenException);
    });

    it("renvoie uniquement l'arrêt de son propre enfant et aucune donnée sur les autres élèves", async () => {
      mockTx.studentGuardian.findFirst.mockResolvedValue({
        studentId,
        student: { id: studentId, displayName: "Mehdi Benjelloun" },
      });

      mockTx.busCircuitStudent.findUnique.mockResolvedValue({
        circuitId: "circuit-1",
        circuit: { id: "circuit-1", name: "Circuit Al Atlas" },
        stopId: "stop-2",
        stop: {
          id: "stop-2",
          name: "Arrêt 2 : Twin Center",
          position: 2,
          latitude: 33.5866,
          longitude: -7.6326,
          radiusMeters: 50,
        },
      });

      mockTx.busTrip.findFirst.mockResolvedValue({
        id: "trip-1",
        status: "in_progress",
        direction: "dropoff",
        startedAt: new Date(),
        positions: [{ latitude: 33.589, longitude: -7.625, speed: 28, heading: 180, recordedAt: new Date() }],
        vehicle: { plateNumber: "12345-A-6", model: "Mercedes Sprinter" },
      });

      const res = await transportService.getParentChildTrip(parentAuth, studentId);

      expect(res.enrolled).toBe(true);
      expect(res.student?.displayName).toBe("Mehdi Benjelloun");
      expect(res.assignedStop?.name).toBe("Arrêt 2 : Twin Center");
      expect((res as any).stops).toBeUndefined();
      expect((res as any).allStudents).toBeUndefined();
      expect(res.trip?.vehicle?.plateNumber).toBe("12345-A-6");
      expect(res.notice).toBe(CNDP_NOTICE_FR);
    });

    it("permet au parent de partager la position exacte de son domicile pour le ramassage", async () => {
      mockTx.studentGuardian.findFirst.mockResolvedValue({
        studentId,
        guardianId: "guardian-1",
        student: { id: studentId, displayName: "Mehdi Benjelloun" },
      });

      mockTx.busCircuitStudent.findUnique.mockResolvedValue({
        circuitId: "circuit-1",
        stopId: "stop-2",
        stop: {
          id: "stop-2",
          name: "Arrêt 2 : Domicile",
          position: 2,
        },
      });

      mockTx.busStop.update = vi.fn().mockResolvedValue({
        id: "stop-2",
        name: "Arrêt 2 : Domicile",
        latitude: 33.5875,
        longitude: -7.6310,
        address: "Résidence Al Yassamine, Bd Massira",
      });

      mockTx.guardian.update = vi.fn().mockResolvedValue({});

      const res = await transportService.shareHomeLocation(parentAuth, studentId, {
        latitude: 33.5875,
        longitude: -7.6310,
        address: "Résidence Al Yassamine, Bd Massira",
      });

      expect(res.ok).toBe(true);
      expect(res.stop.latitude).toBe(33.5875);
      expect(res.stop.longitude).toBe(-7.6310);
      expect(res.stop.address).toBe("Résidence Al Yassamine, Bd Massira");
      expect(mockTx.busStop.update).toHaveBeenCalledWith({
        where: { id: "stop-2" },
        data: {
          latitude: 33.5875,
          longitude: -7.6310,
          address: "Résidence Al Yassamine, Bd Massira",
        },
      });
      expect(mockAudit.scoped).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "transport.stop.location_shared_by_parent",
        }),
      );
    });

    it("refuse le partage de position si l'utilisateur n'est pas le responsable légal de l'élève", async () => {
      mockTx.studentGuardian.findFirst.mockResolvedValue(null);

      const strangerAuth: AuthContext = {
        ...parentAuth,
        userId: strangerParentUserId,
      };

      await expect(
        transportService.shareHomeLocation(strangerAuth, studentId, {
          latitude: 33.5875,
          longitude: -7.6310,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
