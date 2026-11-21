import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import { AuditService } from "../audit/audit.service";
import { TenancyService, type TenantContext } from "../core/tenancy.service";
import { requireSchool } from "../parent-space/common";
import { TransportEtaService } from "./transport-eta.service";
import { TransportRealtimeService, type TripLivePayload } from "./transport-realtime.service";
import { TransportNotificationService, type StudentNotificationTarget } from "./transport-notification.service";
import type {
  CreateVehicleDto,
  IngestPositionsDto,
  RecordStopEventDto,
  ShareParentLocationDto,
  StartTripDto,
  UpdateStopCoordinatesDto,
} from "./transport.dto";

const RETENTION_DAYS = 30; // 30 jours max conformément aux directives CNDP / Loi 09-08

export const CNDP_NOTICE_FR = `Conformément à la loi n° 09-08 relative à la protection des personnes physiques à l'égard du traitement des données à caractère personnel, la géolocalisation des navettes de transport scolaire a pour finalité exclusive d'assurer la sécurité des élèves transportés et d'informer leurs représentants légaux des horaires de passage. Les coordonnées GPS ne sont collectées que pendant la durée effective des tournées et sont conservées pendant un délai maximal de 30 jours. Les chauffeurs et parents peuvent exercer leurs droits d'accès et de rectification auprès de la direction de l'établissement.`;

export const CNDP_NOTICE_AR = `وفقاً للقانون رقم 09-08 المتعلق بحماية الأشخاص الذاتيين تجاه معالجة المعطيات ذات الطابع الشخصي، يهدف التتبع الجغرافي لحافلات النقل المدرسي حصرياً إلى ضمان سلامة التلاميذ المنقولين وإشعار أولياء أمورهم بمواعيد الوصول. لا يتم تسجيل الإحداثيات إلا خلال الرحلات الفعلية وتحفظ لمدة أقصاها 30 يوماً.`;

@Injectable()
export class TransportService {
  private readonly logger = new Logger(TransportService.name);

  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly etaService: TransportEtaService,
    private readonly realtimeService: TransportRealtimeService,
    private readonly notificationService: TransportNotificationService,
  ) {}

  /**
   * Retourne la notice d'information légale Loi 09-08 / CNDP.
   */
  getLegalNotice() {
    return {
      fr: CNDP_NOTICE_FR,
      ar: CNDP_NOTICE_AR,
      retentionDays: RETENTION_DAYS,
    };
  }

  /**
   * Démarrage d'une tournée par le chauffeur ou la direction.
   */
  async startTrip(auth: AuthContext, dto: StartTripDto) {
    const schoolId = requireSchool(auth);
    if (auth.role !== "chauffeur" && auth.role !== "bus_attendant" && auth.role !== "direction") {
      throw new ForbiddenException("Rôle non autorisé à démarrer une tournée.");
    }

    const context = toTenantContext(auth);
    const trip = await this.tenancy.run(context, async (tx) => {
      // 1. Vérification du paramètre école
      const school = await tx.school.findUnique({
        where: { id: schoolId },
        select: { id: true, transportTrackingEnabled: true, latitude: true, longitude: true },
      });
      if (!school?.transportTrackingEnabled) {
        throw new ForbiddenException("Le suivi GPS du transport est désactivé pour cet établissement.");
      }

      // 2. Vérification du circuit
      const circuit = await tx.busCircuit.findFirst({
        where: { id: dto.circuitId, schoolId, active: true },
        include: { stops: { orderBy: { position: "asc" } }, vehicle: true },
      });
      if (!circuit) throw new NotFoundException("Circuit de transport introuvable.");

      // Si chauffeur/accompagnateur, vérifie qu'il s'agit bien de son circuit (sauf si assigné par direction)
      if (
        (auth.role === "chauffeur" || auth.role === "bus_attendant") &&
        circuit.attendantProfileId &&
        circuit.attendantProfileId !== auth.profileId
      ) {
        throw new ForbiddenException("Ce circuit ne vous est pas affecté.");
      }

      // 3. Vérifie qu'il n'y a pas déjà une tournée en cours pour ce circuit
      const running = await tx.busTrip.findFirst({
        where: { circuitId: dto.circuitId, status: "in_progress" },
        select: { id: true },
      });
      if (running) {
        throw new ConflictException("Une tournée est déjà en cours sur ce circuit.");
      }

      const vehicleId = dto.vehicleId ?? circuit.vehicleId ?? null;

      const created = await tx.busTrip.create({
        data: {
          schoolId,
          circuitId: dto.circuitId,
          driverProfileId: auth.profileId,
          vehicleId,
          direction: dto.direction,
          status: "in_progress",
          startedAt: new Date(),
          notes: dto.notes ?? null,
        },
        include: {
          circuit: {
            select: {
              name: true,
              stops: { orderBy: { position: "asc" } },
            },
          },
        },
      });

      return created;
    });

    await this.audit.scoped(context, {
      action: "transport.trip.start",
      entity: "BusTrip",
      entityId: trip.id,
      metadata: { circuitId: dto.circuitId, direction: dto.direction },
    });

    // Émission temps réel du statut
    this.realtimeService.broadcastTripUpdate(schoolId, {
      tripId: trip.id,
      type: "trip_status",
      status: "in_progress",
      recordedAt: new Date().toISOString(),
    });

    return trip;
  }

  /**
   * Clôture de la tournée par le chauffeur ou la direction.
   */
  async endTrip(auth: AuthContext, tripId: string) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);

    const trip = await this.tenancy.run(context, async (tx) => {
      const existing = await tx.busTrip.findFirst({
        where: { id: tripId, schoolId },
      });
      if (!existing) throw new NotFoundException("Tournée introuvable.");
      if (existing.status !== "in_progress") {
        throw new BadRequestException("Cette tournée n'est pas en cours.");
      }
      if (
        (auth.role === "chauffeur" || auth.role === "bus_attendant") &&
        existing.driverProfileId !== auth.profileId
      ) {
        throw new ForbiddenException("Vous n'êtes pas le chauffeur de cette tournée.");
      }

      return tx.busTrip.update({
        where: { id: tripId },
        data: {
          status: "completed",
          endedAt: new Date(),
        },
      });
    });

    await this.audit.scoped(context, {
      action: "transport.trip.end",
      entity: "BusTrip",
      entityId: trip.id,
      metadata: { durationMinutes: trip.startedAt ? Math.round((Date.now() - trip.startedAt.getTime()) / 60000) : 0 },
    });

    this.realtimeService.broadcastTripUpdate(schoolId, {
      tripId: trip.id,
      type: "trip_status",
      status: "completed",
      recordedAt: new Date().toISOString(),
    });

    this.realtimeService.closeTripStream(trip.id);

    return { ok: true, status: "completed", endedAt: trip.endedAt };
  }

  /**
   * Ingestion de points GPS avec calcul ETA et déclenchement des alertes 5 min.
   */
  async recordPositions(auth: AuthContext, tripId: string, dto: IngestPositionsDto) {
    const schoolId = requireSchool(auth);
    if (!dto.positions || dto.positions.length === 0) return { count: 0, latest: null, etaByStop: {} };

    const context = toTenantContext(auth);
    const result = await this.tenancy.run(context, async (tx) => {
      const trip = await tx.busTrip.findFirst({
        where: { id: tripId, schoolId },
        include: {
          circuit: {
            include: {
              stops: {
                orderBy: { position: "asc" },
                include: {
                  students: {
                    include: {
                      student: {
                        include: {
                          guardians: {
                            include: {
                              guardian: {
                                select: { userId: true },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!trip) throw new NotFoundException("Tournée introuvable.");
      if (trip.status !== "in_progress") {
        throw new BadRequestException("Impossible d'ingérer des coordonnées : la tournée n'est pas en cours.");
      }
      if (
        (auth.role === "chauffeur" || auth.role === "bus_attendant") &&
        trip.driverProfileId !== auth.profileId
      ) {
        throw new ForbiddenException("Vous n'êtes pas le chauffeur de cette tournée.");
      }

      // 1. Sauvegarde des points en base
      const rows = dto.positions.map((p) => ({
        schoolId,
        tripId,
        latitude: p.latitude,
        longitude: p.longitude,
        speed: p.speed ?? null,
        heading: p.heading ?? null,
        accuracy: p.accuracy ?? null,
        recordedAt: p.recordedAt ? new Date(p.recordedAt) : new Date(),
      }));

      await tx.busTripPosition.createMany({ data: rows });

      // 2. Dernier point reçu
      const latest = rows[rows.length - 1];
      if (!latest) throw new BadRequestException("Aucune coordonnée valide.");

      // 3. Calcul de l'ETA pour chaque arrêt et déclenchement des notifications
      const etaByStop: Record<string, { etaMinutes: number; distanceMeters: number }> = {};

      for (const stop of trip.circuit.stops) {
        if (stop.latitude == null || stop.longitude == null) continue;

        const stopLocation = { latitude: stop.latitude, longitude: stop.longitude };
        const busLocation = { latitude: latest.latitude, longitude: latest.longitude };
        const eta = this.etaService.computeEta(busLocation, stopLocation, stop.radiusMeters, latest.speed);

        etaByStop[stop.id] = {
          etaMinutes: eta.etaMinutes,
          distanceMeters: eta.distanceMeters,
        };

        // Si le bus est à environ 5 minutes de l'arrêt
        if (this.etaService.isApproachingWithin5Min(eta.etaMinutes, eta.distanceMeters)) {
          for (const bs of stop.students) {
            const guardianUserIds = bs.student.guardians
              .map((g) => g.guardian.userId)
              .filter((uid): uid is string => Boolean(uid));

            const target: StudentNotificationTarget = {
              studentId: bs.student.id,
              studentName: bs.student.displayName,
              stopId: stop.id,
              stopName: stop.name,
              guardianUserIds,
            };

            await this.notificationService.notifyEta5Minutes(tx, schoolId, tripId, target, eta.etaMinutes);
          }
        }

        // Si le bus est arrivé physiquement dans le rayon de l'arrêt
        if (eta.isWithinRadius) {
          for (const bs of stop.students) {
            const guardianUserIds = bs.student.guardians
              .map((g) => g.guardian.userId)
              .filter((uid): uid is string => Boolean(uid));

            const target: StudentNotificationTarget = {
              studentId: bs.student.id,
              studentName: bs.student.displayName,
              stopId: stop.id,
              stopName: stop.name,
              guardianUserIds,
            };

            await this.notificationService.notifyBusArrivedAtStop(tx, schoolId, tripId, target);
          }
        }
      }

      return {
        count: rows.length,
        latest,
        etaByStop,
      };
    });

    // 4. Diffusion temps réel SSE
    this.realtimeService.broadcastTripUpdate(schoolId, {
      tripId,
      type: "position",
      latitude: result.latest.latitude,
      longitude: result.latest.longitude,
      speed: result.latest.speed,
      heading: result.latest.heading,
      accuracy: result.latest.accuracy,
      recordedAt: result.latest.recordedAt.toISOString(),
      etaByStop: result.etaByStop,
    });

    return { ok: true, count: result.count, etaByStop: result.etaByStop };
  }

  /**
   * Enregistre un événement de passage à un arrêt (arrivée, montée, dépose).
   */
  async recordStopEvent(auth: AuthContext, tripId: string, dto: RecordStopEventDto) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);

    const event = await this.tenancy.run(context, async (tx) => {
      const trip = await tx.busTrip.findFirst({
        where: { id: tripId, schoolId },
      });
      if (!trip) throw new NotFoundException("Tournée introuvable.");
      if (trip.status !== "in_progress") {
        throw new BadRequestException("La tournée n'est pas en cours.");
      }

      const stop = await tx.busStop.findFirst({
        where: { id: dto.stopId, schoolId },
        include: {
          students: {
            include: {
              student: {
                include: {
                  guardians: {
                    include: { guardian: { select: { userId: true } } },
                  },
                },
              },
            },
          },
        },
      });
      if (!stop) throw new NotFoundException("Arrêt introuvable.");

      const createdEvent = await tx.busTripStopEvent.create({
        data: {
          schoolId,
          tripId,
          stopId: dto.stopId,
          eventType: dto.eventType,
        },
      });

      // Si arrivée ou dépose, envoyer alerte aux familles si pas encore fait
      if (dto.eventType === "arrived" || dto.eventType === "students_dropped") {
        for (const bs of stop.students) {
          const guardianUserIds = bs.student.guardians
            .map((g) => g.guardian.userId)
            .filter((uid): uid is string => Boolean(uid));

          const target: StudentNotificationTarget = {
            studentId: bs.student.id,
            studentName: bs.student.displayName,
            stopId: stop.id,
            stopName: stop.name,
            guardianUserIds,
          };

          await this.notificationService.notifyBusArrivedAtStop(tx, schoolId, tripId, target);
        }
      }

      return createdEvent;
    });

    this.realtimeService.broadcastTripUpdate(schoolId, {
      tripId,
      type: "stop_event",
      stopId: dto.stopId,
      eventType: dto.eventType,
      recordedAt: event.recordedAt.toISOString(),
    });

    return event;
  }

  /**
   * Retourne la session active du chauffeur (circuit, arrêts, élèves, tournée en cours).
   */
  async getDriverSession(auth: AuthContext) {
    const schoolId = requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      // 1. Tournée en cours
      const activeTrip = await tx.busTrip.findFirst({
        where: {
          schoolId,
          driverProfileId: auth.profileId,
          status: "in_progress",
        },
        include: {
          circuit: {
            include: {
              stops: {
                orderBy: { position: "asc" },
                include: {
                  students: {
                    include: {
                      student: {
                        select: { id: true, displayName: true, studentCode: true },
                      },
                    },
                  },
                },
              },
              vehicle: true,
            },
          },
          positions: {
            orderBy: { recordedAt: "desc" },
            take: 1,
          },
          stopEvents: {
            orderBy: { recordedAt: "desc" },
          },
        },
      });

      // 2. Circuits assignés au chauffeur
      const circuits = await tx.busCircuit.findMany({
        where: {
          schoolId,
          active: true,
          attendantProfileId: auth.profileId,
        },
        include: {
          stops: { orderBy: { position: "asc" } },
          vehicle: true,
          _count: { select: { students: true } },
        },
      });

      // 3. Véhicules disponibles dans l'école
      const vehicles = await tx.busVehicle.findMany({
        where: { schoolId, active: true },
        orderBy: { plateNumber: "asc" },
      });

      return {
        activeTrip: activeTrip
          ? {
              id: activeTrip.id,
              circuitId: activeTrip.circuitId,
              circuitName: activeTrip.circuit.name,
              direction: activeTrip.direction,
              startedAt: activeTrip.startedAt,
              vehicle: activeTrip.circuit.vehicle,
              stops: activeTrip.circuit.stops.map((s) => ({
                id: s.id,
                name: s.name,
                position: s.position,
                latitude: s.latitude,
                longitude: s.longitude,
                address: s.address,
                radiusMeters: s.radiusMeters,
                students: s.students.map((st) => ({
                  id: st.student.id,
                  displayName: st.student.displayName,
                  code: st.student.studentCode,
                })),
              })),
              lastPosition: activeTrip.positions[0] ?? null,
              stopEvents: activeTrip.stopEvents,
            }
          : null,
        circuits: circuits.map((c) => ({
          id: c.id,
          name: c.name,
          stopCount: c.stops.length,
          studentCount: c._count.students,
          vehicle: c.vehicle,
        })),
        vehicles,
      };
    });
  }

  /**
   * Consultation sécurisée pour un parent : trajet et position de son enfant.
   * RÈGLE DE CONFIDENTIALITÉ : ne renvoie QUE l'arrêt et le bus de son propre enfant.
   */
  async getParentChildTrip(auth: AuthContext, studentId: string) {
    const schoolId = requireSchool(auth);

    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      // 1. Vérifie le lien de parenté
      const relation = await tx.studentGuardian.findFirst({
        where: {
          schoolId,
          studentId,
          guardian: { userId: auth.userId },
        },
        include: {
          student: {
            select: { id: true, displayName: true },
          },
        },
      });

      if (!relation && auth.role !== "direction" && auth.role !== "super_admin") {
        throw new ForbiddenException("Vous n'êtes pas le responsable légal de cet élève.");
      }

      // 2. Circuit et arrêt de l'enfant
      const circuitStudent = await tx.busCircuitStudent.findUnique({
        where: { studentId },
        include: {
          circuit: true,
          stop: true,
        },
      });

      if (!circuitStudent) {
        return {
          enrolled: false,
          student: relation?.student ?? null,
          trip: null,
          notice: CNDP_NOTICE_FR,
        };
      }

      // 3. Tournée en cours sur ce circuit
      const activeTrip = await tx.busTrip.findFirst({
        where: {
          circuitId: circuitStudent.circuitId,
          status: "in_progress",
        },
        include: {
          positions: {
            orderBy: { recordedAt: "desc" },
            take: 1,
          },
          vehicle: true,
        },
      });

      const school = await tx.school.findUnique({
        where: { id: schoolId },
        select: { name: true, latitude: true, longitude: true },
      });

      let etaMinutes: number | null = null;
      let distanceMeters: number | null = null;

      if (activeTrip?.positions[0] && circuitStudent.stop?.latitude && circuitStudent.stop?.longitude) {
        const lastPos = activeTrip.positions[0];
        const eta = this.etaService.computeEta(
          { latitude: lastPos.latitude, longitude: lastPos.longitude },
          { latitude: circuitStudent.stop.latitude, longitude: circuitStudent.stop.longitude },
          circuitStudent.stop.radiusMeters,
          lastPos.speed,
        );
        etaMinutes = eta.etaMinutes;
        distanceMeters = eta.distanceMeters;
      }

      return {
        enrolled: true,
        student: relation?.student ?? { id: studentId, displayName: "Élève" },
        circuit: {
          id: circuitStudent.circuit.id,
          name: circuitStudent.circuit.name,
        },
        assignedStop: circuitStudent.stop
          ? {
              id: circuitStudent.stop.id,
              name: circuitStudent.stop.name,
              latitude: circuitStudent.stop.latitude,
              longitude: circuitStudent.stop.longitude,
              address: circuitStudent.stop.address,
            }
          : null,
        schoolLocation: school
          ? {
              name: school.name,
              latitude: school.latitude ?? 33.5898,
              longitude: school.longitude ?? -7.6038,
            }
          : null,
        trip: activeTrip
          ? {
              id: activeTrip.id,
              direction: activeTrip.direction,
              startedAt: activeTrip.startedAt,
              status: activeTrip.status,
              vehicle: activeTrip.vehicle,
              latestPosition: activeTrip.positions[0] ?? null,
              etaMinutes,
              distanceMeters,
            }
          : null,
        notice: CNDP_NOTICE_FR,
      };
    });
  }

  /**
   * Partage de la localisation du domicile par un parent pour le ramassage scolaire.
   * Permet au chauffeur de connaître l'emplacement exact de la maison de l'enfant.
   */
  async shareHomeLocation(auth: AuthContext, studentId: string, dto: ShareParentLocationDto) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);

    return this.tenancy.run(context, async (tx) => {
      // 1. Vérification du lien de parenté
      const relation = await tx.studentGuardian.findFirst({
        where: {
          schoolId,
          studentId,
          guardian: { userId: auth.userId },
        },
        include: {
          student: {
            select: { id: true, displayName: true },
          },
        },
      });

      if (!relation && auth.role !== "direction" && auth.role !== "super_admin") {
        throw new ForbiddenException("Vous n'êtes pas le responsable légal de cet élève.");
      }

      const studentName = relation?.student.displayName ?? "Élève";

      // 2. Recherche du circuit auquel l'enfant est rattaché
      const circuitStudent = await tx.busCircuitStudent.findUnique({
        where: { studentId },
        include: {
          circuit: true,
          stop: true,
        },
      });

      if (!circuitStudent) {
        throw new BadRequestException(
          "L'élève n'est pas encore inscrit à un circuit de transport scolaire par l'établissement.",
        );
      }

      let updatedStop;
      const cleanAddress = dto.address?.trim() || `Domicile de ${studentName}`;

      // 3. Si l'élève dispose déjà d'un arrêt assigné sur ce circuit, on met à jour ses coordonnées GPS
      if (circuitStudent.stopId) {
        updatedStop = await tx.busStop.update({
          where: { id: circuitStudent.stopId },
          data: {
            latitude: dto.latitude,
            longitude: dto.longitude,
            address: cleanAddress,
          },
        });
      } else {
        // Si aucun arrêt n'était assigné, on crée un nouvel arrêt "Domicile" sur le circuit
        const lastStop = await tx.busStop.findFirst({
          where: { circuitId: circuitStudent.circuitId },
          orderBy: { position: "desc" },
          select: { position: true },
        });

        const nextPosition = (lastStop?.position ?? 0) + 1;
        updatedStop = await tx.busStop.create({
          data: {
            schoolId,
            circuitId: circuitStudent.circuitId,
            name: `Arrêt Domicile — ${studentName}`,
            position: nextPosition,
            latitude: dto.latitude,
            longitude: dto.longitude,
            address: cleanAddress,
            radiusMeters: 50,
          },
        });

        // Association de l'arrêt à l'élève
        await tx.busCircuitStudent.update({
          where: { studentId },
          data: { stopId: updatedStop.id },
        });
      }

      // Mise à jour de l'adresse du responsable légal si disponible
      if (relation?.guardianId && dto.address?.trim()) {
        await tx.guardian.update({
          where: { id: relation.guardianId },
          data: { address: dto.address.trim() },
        });
      }

      // Si demandé, aligner l'école de test à proximité (~1.5 km) pour une simulation locale complète
      if (dto.relocateDemoSchool) {
        const schoolLat = dto.latitude + 0.012;
        const schoolLng = dto.longitude + 0.012;
        await tx.school.update({
          where: { id: schoolId },
          data: {
            latitude: schoolLat,
            longitude: schoolLng,
          },
        });
      }

      await this.audit.scoped(context, {
        action: "transport.stop.location_shared_by_parent",
        entity: "BusStop",
        entityId: updatedStop.id,
        metadata: {
          studentId,
          latitude: dto.latitude,
          longitude: dto.longitude,
          address: cleanAddress,
        },
      });

      return {
        ok: true,
        message: "Emplacement du domicile enregistré avec succès pour les tournées de ramassage.",
        stop: {
          id: updatedStop.id,
          name: updatedStop.name,
          latitude: updatedStop.latitude,
          longitude: updatedStop.longitude,
          address: updatedStop.address,
        },
      };
    });
  }

  /**
   * Vérification des droits pour s'abonner au flux SSE d'une tournée.
   */
  async assertCanSubscribeTrip(auth: AuthContext, tripId: string): Promise<TripLivePayload | null> {
    const schoolId = requireSchool(auth);

    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const trip = await tx.busTrip.findFirst({
        where: { id: tripId, schoolId },
        include: {
          circuit: {
            include: {
              students: {
                include: {
                  student: {
                    include: {
                      guardians: {
                        include: { guardian: true },
                      },
                    },
                  },
                },
              },
            },
          },
          positions: {
            orderBy: { recordedAt: "desc" },
            take: 1,
          },
        },
      });

      if (!trip) throw new NotFoundException("Tournée introuvable.");

      // Direction & chauffeur du bus
      if (
        auth.role === "direction" ||
        auth.role === "super_admin" ||
        trip.driverProfileId === auth.profileId
      ) {
        return this.toTripPayload(trip);
      }

      // Parent : vérifier qu'un de ses enfants est sur ce circuit
      const isParentAllowed = trip.circuit.students.some((cs) =>
        cs.student.guardians.some((g) => g.guardian.userId === auth.userId),
      );

      if (!isParentAllowed) {
        throw new ForbiddenException("Vous n'êtes pas autorisé à suivre cette tournée.");
      }

      return this.toTripPayload(trip);
    });
  }

  private toTripPayload(trip: any): TripLivePayload {
    const last = trip.positions?.[0];
    return {
      tripId: trip.id,
      type: "position",
      latitude: last?.latitude,
      longitude: last?.longitude,
      speed: last?.speed,
      heading: last?.heading,
      accuracy: last?.accuracy,
      status: trip.status,
      recordedAt: (last?.recordedAt ?? trip.startedAt ?? new Date()).toISOString(),
    };
  }

  /**
   * Vue Flotte pour l'administration scolaire.
   */
  async getFleetOverview(auth: AuthContext) {
    const schoolId = requireSchool(auth);
    if (auth.role !== "direction" && auth.role !== "super_admin") {
      throw new ForbiddenException("Accès réservé à la direction.");
    }

    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const [school, activeTrips, circuits, vehicles] = await Promise.all([
        tx.school.findUnique({
          where: { id: schoolId },
          select: { id: true, name: true, transportTrackingEnabled: true, latitude: true, longitude: true },
        }),
        tx.busTrip.findMany({
          where: { schoolId, status: "in_progress" },
          include: {
            circuit: {
              include: {
                stops: { orderBy: { position: "asc" } },
              },
            },
            driver: { select: { displayName: true } },
            vehicle: true,
            positions: {
              orderBy: { recordedAt: "desc" },
              take: 1,
            },
          },
        }),
        tx.busCircuit.findMany({
          where: { schoolId },
          include: {
            stops: { orderBy: { position: "asc" } },
            vehicle: true,
            attendant: { select: { displayName: true } },
            _count: { select: { students: true } },
          },
        }),
        tx.busVehicle.findMany({
          where: { schoolId },
          orderBy: { plateNumber: "asc" },
        }),
      ]);

      return {
        school,
        activeTrips: activeTrips.map((t) => ({
          id: t.id,
          circuitName: t.circuit.name,
          direction: t.direction,
          driverName: t.driver.displayName,
          vehiclePlate: t.vehicle?.plateNumber ?? "Non assigné",
          startedAt: t.startedAt,
          latestPosition: t.positions[0] ?? null,
          stopCount: t.circuit.stops.length,
        })),
        circuits: circuits.map((c) => ({
          id: c.id,
          name: c.name,
          active: c.active,
          color: c.color,
          attendant: c.attendant?.displayName ?? null,
          vehicle: c.vehicle,
          stops: c.stops,
          studentCount: c._count.students,
        })),
        vehicles,
      };
    });
  }

  /**
   * Mise à jour des coordonnées GPS d'un arrêt.
   */
  async updateStopCoordinates(auth: AuthContext, stopId: string, dto: UpdateStopCoordinatesDto) {
    const schoolId = requireSchool(auth);
    if (auth.role !== "direction" && auth.role !== "super_admin") {
      throw new ForbiddenException("Modification réservée à la direction.");
    }

    const context = toTenantContext(auth);
    return this.tenancy.run(context, async (tx) => {
      const stop = await tx.busStop.findFirst({ where: { id: stopId, schoolId } });
      if (!stop) throw new NotFoundException("Arrêt introuvable.");

      return tx.busStop.update({
        where: { id: stopId },
        data: {
          latitude: dto.latitude,
          longitude: dto.longitude,
          address: dto.address ?? stop.address,
          radiusMeters: dto.radiusMeters ?? stop.radiusMeters,
        },
      });
    });
  }

  /**
   * Création d'un véhicule.
   */
  async createVehicle(auth: AuthContext, dto: CreateVehicleDto) {
    const schoolId = requireSchool(auth);
    if (auth.role !== "direction" && auth.role !== "super_admin") {
      throw new ForbiddenException("Action réservée à la direction.");
    }

    const context = toTenantContext(auth);
    return this.tenancy.run(context, async (tx) => {
      try {
        return await tx.busVehicle.create({
          data: {
            schoolId,
            plateNumber: dto.plateNumber.trim(),
            model: dto.model?.trim() ?? null,
            capacity: dto.capacity ?? null,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new ConflictException("Un véhicule avec cette immatriculation existe déjà.");
        }
        throw e;
      }
    });
  }

  /**
   * Activation ou désactivation du tracking transport par la direction.
   */
  async toggleTracking(auth: AuthContext, enabled: boolean) {
    const schoolId = requireSchool(auth);
    if (auth.role !== "direction" && auth.role !== "super_admin") {
      throw new ForbiddenException("Action réservée à la direction.");
    }

    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      return tx.school.update({
        where: { id: schoolId },
        data: { transportTrackingEnabled: enabled },
        select: { id: true, transportTrackingEnabled: true },
      });
    });
  }

  /**
   * Nettoyage automatique des points GPS de plus de 30 jours (conformité CNDP).
   */
  async cleanupOldPositions(): Promise<number> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);
    const systemContext: TenantContext = {
      userId: "00000000-0000-0000-0000-000000000000",
      profileId: "00000000-0000-0000-0000-000000000000",
      schoolId: null,
      isSuperAdmin: true,
    };

    const count = await this.tenancy.run(systemContext, async (tx) => {
      const res = await tx.busTripPosition.deleteMany({
        where: { recordedAt: { lt: cutoff } },
      });
      return res.count;
    });

    if (count > 0) {
      this.logger.log(`[CNDP Purge] ${count} positions GPS purgées (> 30 jours).`);
    }

    return count;
  }
}
