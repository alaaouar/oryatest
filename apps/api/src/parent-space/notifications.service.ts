import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import { TenancyService } from "../core/tenancy.service";

export type NotificationPayload = { kind: string; title: string; body?: string; link?: string };

/** Notifications in-app : chaque compte ne lit que les siennes. */
@Injectable()
export class NotificationsService {
  constructor(private readonly tenancy: TenancyService) {}

  /** Appelé dans la transaction de l'action métier (même contexte RLS). */
  async notifyUsers(
    tx: Prisma.TransactionClient,
    schoolId: string,
    userIds: Iterable<string>,
    payload: NotificationPayload,
  ): Promise<number> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return 0;
    const result = await tx.notification.createMany({
      data: unique.map((userId) => ({
        schoolId,
        userId,
        kind: payload.kind,
        title: payload.title.slice(0, 200),
        body: payload.body?.slice(0, 1000) ?? null,
        link: payload.link ?? null,
      })),
    });
    return result.count;
  }

  async list(auth: AuthContext) {
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const [items, unread] = await Promise.all([
        tx.notification.findMany({
          where: { userId: auth.userId },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true },
        }),
        tx.notification.count({ where: { userId: auth.userId, readAt: null } }),
      ]);
      return { notifications: items, unread };
    });
  }

  async markRead(auth: AuthContext, id: string) {
    const result = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.notification.updateMany({ where: { id, userId: auth.userId, readAt: null }, data: { readAt: new Date() } }),
    );
    if (result.count === 0) {
      const exists = await this.tenancy.run(toTenantContext(auth), (tx) =>
        tx.notification.count({ where: { id, userId: auth.userId } }),
      );
      if (exists === 0) throw new NotFoundException("Notification introuvable.");
    }
    return { ok: true };
  }

  async markAllRead(auth: AuthContext) {
    const result = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.notification.updateMany({ where: { userId: auth.userId, readAt: null }, data: { readAt: new Date() } }),
    );
    return { updated: result.count };
  }
}
