import { ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

export const STAFF_ROLES = ["direction", "teacher", "bus_attendant", "chauffeur"] as const;
const INACTIVE = new Set(["suspended", "cancelled", "expired"]);

/** 402 : la limite du plan est atteinte (montée de plan nécessaire). */
export class PlanLimitException extends HttpException {
  constructor(kind: "students" | "staff", limit: number, current: number, adding: number) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: "PLAN_LIMIT_REACHED",
        message: `Limite du plan atteinte : ${limit} ${kind === "students" ? "élève(s)" : "compte(s) personnel"} maximum (actuel : ${current}, ajout demandé : ${adding}).`,
        limit,
        current,
        adding,
        kind,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * Lot 9 : application des limites et du statut d'abonnement.
 * Toujours appelé avec une transaction déjà scoppée (RLS) sur l'école.
 * Limite null = non définie : rien n'est bloqué (aucune limite inventée).
 */
@Injectable()
export class PlanLimitsService {
  async subscription(tx: Tx, schoolId: string) {
    return tx.subscription.findUnique({
      where: { schoolId },
      select: {
        status: true,
        trialEndsAt: true,
        planRef: { select: { code: true, name: true, maxStudents: true, maxStaff: true, toBeDefined: true } },
      },
    });
  }

  /** 403 si suspendu / résilié / expiré ; 402 si l'essai est terminé. */
  async assertWritable(tx: Tx, schoolId: string, now = new Date()) {
    const sub = await this.subscription(tx, schoolId);
    if (!sub) return;
    if (INACTIVE.has(sub.status)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "SUBSCRIPTION_INACTIVE",
        message: `Abonnement ${sub.status === "suspended" ? "suspendu" : sub.status === "cancelled" ? "résilié" : "expiré"} : l'établissement est en lecture seule. Contactez ORYA.`,
      });
    }
    if (sub.status === "trial" && sub.trialEndsAt && sub.trialEndsAt < now) {
      throw new HttpException(
        { statusCode: 402, code: "TRIAL_EXPIRED", message: "La période d'essai est terminée : un abonnement actif est nécessaire pour modifier les données." },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async assertCapacity(tx: Tx, schoolId: string, kind: "students" | "staff", adding: number) {
    if (adding <= 0) return;
    const sub = await this.subscription(tx, schoolId);
    const limit = kind === "students" ? sub?.planRef?.maxStudents : sub?.planRef?.maxStaff;
    if (limit === null || limit === undefined) return;
    const current = kind === "students" ? await tx.student.count({ where: { schoolId } }) : await this.staffCount(tx, schoolId);
    if (current + adding > limit) throw new PlanLimitException(kind, limit, current, adding);
  }

  /** Comptes personnel actifs + invitations personnel en attente. */
  async staffCount(tx: Tx, schoolId: string) {
    const [profiles, pending] = await Promise.all([
      tx.userProfile.count({ where: { schoolId, role: { in: [...STAFF_ROLES] } } }),
      tx.invitation.count({ where: { schoolId, role: { in: ["teacher", "bus_attendant", "chauffeur"] }, usedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return profiles + pending;
  }
}
