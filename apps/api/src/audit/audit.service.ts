import { Injectable, Logger } from "@nestjs/common";
import type { AuditSeverity, Prisma } from "@prisma/client";
import { PrismaService } from "../core/prisma.service";
import { TenancyService, type TenantContext } from "../core/tenancy.service";

export type AuditEntry = {
  action: string;
  entity: string;
  entityId?: string | null;
  severity?: AuditSeverity;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Journal d'audit (CDC §8 S-5).
 *
 * Deux modes :
 *  - session()  : événement lié à l'identité (connexion, MFA, appareil),
 *                 avant qu'un contexte d'école n'existe ;
 *  - scoped()   : événement dans une école (le schoolId vient du contexte).
 *
 * Une erreur d'audit ne doit jamais faire échouer l'action métier : elle est
 * journalisée côté serveur et l'action continue.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
  ) {}

  async session(userId: string, entry: AuditEntry): Promise<void> {
    try {
      await this.tenancy.runIdentity(userId, (tx) =>
        tx.auditLog.create({
          data: {
            actorId: userId,
            schoolId: null,
            action: entry.action,
            entity: entry.entity,
            entityId: entry.entityId ?? null,
            severity: entry.severity ?? "info",
            metadata: toJson(entry.metadata),
            ip: entry.ip ?? null,
            userAgent: entry.userAgent ?? null,
          },
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Écriture d'audit impossible (${entry.action}) : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async scoped(context: TenantContext, entry: AuditEntry): Promise<void> {
    try {
      await this.tenancy.run(context, (tx) =>
        tx.auditLog.create({
          data: {
            actorId: context.userId,
            schoolId: context.schoolId,
            action: entry.action,
            entity: entry.entity,
            entityId: entry.entityId ?? null,
            severity: entry.severity ?? "info",
            metadata: toJson(entry.metadata),
            ip: entry.ip ?? null,
            userAgent: entry.userAgent ?? null,
          },
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Écriture d'audit impossible (${entry.action}) : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Événement sans session (activation publique, tentative échouée).
   * Rattaché à l'école quand elle est connue ; sinon journalisé côté serveur
   * uniquement, faute de contexte RLS.
   */
  async attempt(input: {
    schoolId: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    severity?: AuditSeverity;
    metadata?: Record<string, unknown>;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    if (!input.schoolId) {
      this.logger.warn(`[audit] ${input.action} sans école (ip=${input.ip ?? "?"})`);
      return;
    }

    try {
      await this.tenancy.runSchool(input.schoolId, (tx) =>
        tx.auditLog.create({
          data: {
            actorId: null,
            schoolId: input.schoolId,
            action: input.action,
            entity: input.entity,
            entityId: input.entityId ?? null,
            severity: input.severity ?? "warning",
            metadata: toJson(input.metadata),
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
          },
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Écriture d'audit impossible (${input.action}) : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Journal visible par l'école (RLS) ou par le super-admin (toutes les écoles). */
  async list(context: TenantContext, limit = 100) {
    return this.tenancy.run(context, (tx) =>
      tx.auditLog.findMany({
        take: Math.min(Math.max(limit, 1), 200),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          severity: true,
          schoolId: true,
          createdAt: true,
        },
      }),
    );
  }

  /** Compte les événements récents d'un utilisateur (protection anti-rejeu MFA). */
  async countRecent(userId: string, action: string, since: Date): Promise<number> {
    return this.tenancy.runIdentity(userId, (tx) =>
      tx.auditLog.count({ where: { actorId: userId, action, createdAt: { gte: since } } }),
    );
  }
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as Prisma.InputJsonValue;
}
