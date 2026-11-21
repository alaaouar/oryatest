import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { NotificationsService } from "../parent-space/notifications.service";

type Tx = Prisma.TransactionClient;

export type StudentNotificationTarget = {
  studentId: string;
  studentName: string;
  stopId: string;
  stopName: string;
  guardianUserIds: string[];
};

@Injectable()
export class TransportNotificationService {
  private readonly logger = new Logger(TransportNotificationService.name);

  constructor(private readonly notifications: NotificationsService) {}

  /**
   * Envoie une notification d'approche (~5 minutes) aux parents d'un élève.
   * STRICTEMENT IDEMPOTENTE : vérifie et écrit dans TransportNotificationLog.
   */
  async notifyEta5Minutes(
    tx: Tx,
    schoolId: string,
    tripId: string,
    target: StudentNotificationTarget,
    etaMinutes: number,
  ): Promise<boolean> {
    const notificationType = "eta_5min";

    // Vérification de non-duplication
    const existing = await tx.transportNotificationLog.findUnique({
      where: {
        tripId_studentId_notificationType: {
          tripId,
          studentId: target.studentId,
          notificationType,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return false; // Déjà notifié pour cette tournée
    }

    // Enregistrement atomique
    await tx.transportNotificationLog.create({
      data: {
        schoolId,
        tripId,
        studentId: target.studentId,
        stopId: target.stopId,
        notificationType,
        channel: "in_app",
      },
    });

    if (target.guardianUserIds.length === 0) return true;

    const title = `🚌 Le bus arrive dans ~${Math.max(1, etaMinutes)} min`;
    const body = `La navette de ${target.studentName} approche de l'arrêt "${target.stopName}". Préparez-vous !`;

    await this.notifications.notifyUsers(tx, schoolId, target.guardianUserIds, {
      kind: "transport_eta",
      title,
      body,
      link: `/family?tab=transport&studentId=${target.studentId}`,
    });

    this.logger.log(
      `[ETA 5min] Notification envoyée pour l'élève ${target.studentName} (arrêt: ${target.stopName}, tournée: ${tripId})`,
    );

    return true;
  }

  /**
   * Envoie une notification "Le bus est arrivé à votre arrêt".
   * STRICTEMENT IDEMPOTENTE.
   */
  async notifyBusArrivedAtStop(
    tx: Tx,
    schoolId: string,
    tripId: string,
    target: StudentNotificationTarget,
  ): Promise<boolean> {
    const notificationType = "bus_arrived";

    const existing = await tx.transportNotificationLog.findUnique({
      where: {
        tripId_studentId_notificationType: {
          tripId,
          studentId: target.studentId,
          notificationType,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return false;
    }

    await tx.transportNotificationLog.create({
      data: {
        schoolId,
        tripId,
        studentId: target.studentId,
        stopId: target.stopId,
        notificationType,
        channel: "in_app",
      },
    });

    if (target.guardianUserIds.length === 0) return true;

    const title = `📍 Le bus est arrivé à l'arrêt`;
    const body = `La navette de ${target.studentName} est actuellement à l'arrêt "${target.stopName}".`;

    await this.notifications.notifyUsers(tx, schoolId, target.guardianUserIds, {
      kind: "transport_arrival",
      title,
      body,
      link: `/family?tab=transport&studentId=${target.studentId}`,
    });

    this.logger.log(
      `[Bus Arrivé] Notification envoyée pour l'élève ${target.studentName} (arrêt: ${target.stopName})`,
    );

    return true;
  }
}
