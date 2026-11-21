import type { Prisma } from "@prisma/client";

export type ChannelName = "in_app" | "email";

export type ChannelMessage = { kind: string; title: string; body?: string; link?: string };

export type ChannelReport = {
  channel: ChannelName;
  /** sent : remis ; not_configured : aucun fournisseur branché, rien n'a été envoyé. */
  status: "sent" | "not_configured";
  label: string;
  delivered: number;
};

/**
 * Canal de notification. Un canal non configuré ne simule jamais un envoi :
 * il répond « non configuré » avec 0 remise.
 */
export interface NotificationChannel {
  readonly name: ChannelName;
  readonly configured: boolean;
  send(
    tx: Prisma.TransactionClient,
    schoolId: string,
    userIds: string[],
    message: ChannelMessage,
  ): Promise<ChannelReport>;
}
