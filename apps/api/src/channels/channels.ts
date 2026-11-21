import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { NotificationsService } from "../parent-space/notifications.service";
import type { ChannelMessage, ChannelName, ChannelReport, NotificationChannel } from "./channel.types";

/** Canal réel : notification in-app stockée en base (même transaction RLS). */
@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly name = "in_app" as const;
  readonly configured = true;

  constructor(private readonly notifications: NotificationsService) {}

  async send(tx: Prisma.TransactionClient, schoolId: string, userIds: string[], message: ChannelMessage) {
    const delivered = await this.notifications.notifyUsers(tx, schoolId, userIds, message);
    return { channel: this.name, status: "sent", label: "Envoyé dans l'application", delivered } satisfies ChannelReport;
  }
}

/**
 * Canaux externes désactivés : aucun fournisseur (payant) n'est branché sans
 * validation d'Ayoub. Ils ne contactent rien et ne prétendent rien avoir envoyé.
 */
abstract class DisabledChannel implements NotificationChannel {
  abstract readonly name: ChannelName;
  readonly configured = false;

  send(): Promise<ChannelReport> {
    return Promise.resolve({ channel: this.name, status: "not_configured", label: "Non configuré", delivered: 0 });
  }
}

@Injectable()
export class EmailChannel extends DisabledChannel {
  readonly name = "email" as const;
}

/** Point d'entrée unique : in-app toujours, autres canaux sur demande. */
@Injectable()
export class NotificationDispatcher {
  private readonly channels: NotificationChannel[];

  constructor(inApp: InAppChannel, email: EmailChannel) {
    this.channels = [inApp, email];
  }

  list() {
    return this.channels.map((channel) => ({
      channel: channel.name,
      configured: channel.configured,
      label: channel.configured ? "Actif" : "Non configuré",
    }));
  }

  async dispatch(
    tx: Prisma.TransactionClient,
    schoolId: string,
    userIds: string[],
    message: ChannelMessage,
    requested: ChannelName[] = [],
  ): Promise<ChannelReport[]> {
    const wanted = new Set<ChannelName>(["in_app", ...requested]);
    const reports: ChannelReport[] = [];
    for (const channel of this.channels) {
      if (wanted.has(channel.name)) {
        reports.push(await channel.send(tx, schoolId, userIds, message));
      }
    }
    return reports;
  }
}
