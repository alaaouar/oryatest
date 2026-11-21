import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService, type JwtSignOptions } from "@nestjs/jwt";
import type { ProfileRole } from "@prisma/client";
import { randomToken, safeEqual, sha256 } from "../core/crypto";
import { PrismaService } from "../core/prisma.service";
import { TenancyService } from "../core/tenancy.service";
import type { AccessTokenPayload, ChallengePayload } from "./auth.types";
import { idleLimitMs, isIdle, needsTouch } from "./session-idle";

export type SessionProfile = {
  id: string;
  role: ProfileRole;
  schoolId: string | null;
};

export type CreatedSession = {
  deviceId: string;
  refreshToken: string;
};

export type RotatedSession = {
  device: {
    id: string;
    userId: string;
    schoolId: string | null;
    activeProfileId: string | null;
  };
  refreshToken: string;
};

const REFRESH_PREFIX = "v1";
const CHALLENGE_TTL: JwtSignOptions["expiresIn"] = "5m";

/**
 * Émission et validation des jetons.
 *
 * - Jeton d'accès : JWT signé, courte durée (15 min par défaut).
 * - Jeton de rafraîchissement : valeur opaque `v1.<userId>.<deviceId>.<secret>`.
 *   Seul le SHA-256 du secret est stocké (Device.refreshTokenHash) et il est
 *   remplacé à chaque usage (rotation). Un jeton rejoué révoque l'appareil.
 * - Jeton de défi : JWT 5 minutes émis entre le mot de passe et le second facteur.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
  ) {}

  private get accessSecret(): string {
    return this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
  }

  private get accessTtl(): JwtSignOptions["expiresIn"] {
    // La valeur vient de l'environnement (ex. "15m") : le type de jsonwebtoken
    // attend un littéral de durée, d'où la conversion explicite.
    return (this.config.get<string>("JWT_ACCESS_TTL") ?? "15m") as JwtSignOptions["expiresIn"];
  }

  async signAccess(input: {
    userId: string;
    profileId: string;
    deviceId: string;
    schoolId: string | null;
    role: ProfileRole;
    mfa: boolean;
  }): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: input.userId,
      pid: input.profileId,
      sid: input.deviceId,
      sch: input.schoolId,
      rol: input.role,
      mfa: input.mfa,
      typ: "access",
    };

    return this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessTtl,
    });
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.accessSecret,
      });

      if (payload.typ !== "access") {
        throw new Error("Type de jeton inattendu.");
      }

      return payload;
    } catch {
      throw new UnauthorizedException("Session invalide ou expirée.");
    }
  }

  async signChallenge(userId: string, method: "enroll" | "verify"): Promise<string> {
    const payload: ChallengePayload = { sub: userId, typ: "mfa", mth: method };

    return this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: CHALLENGE_TTL,
    });
  }

  async verifyChallenge(token: string): Promise<ChallengePayload> {
    try {
      const payload = await this.jwt.verifyAsync<ChallengePayload>(token, {
        secret: this.accessSecret,
      });

      if (payload.typ !== "mfa") {
        throw new Error("Type de jeton inattendu.");
      }

      return payload;
    } catch {
      throw new UnauthorizedException("Défi d'authentification invalide ou expiré.");
    }
  }

  /** Crée un appareil et retourne le jeton de rafraîchissement en clair (une seule fois). */
  async createSession(input: {
    userId: string;
    profile: SessionProfile;
    platform?: string;
  }): Promise<CreatedSession> {
    const secret = randomToken(32);

    const device = await this.tenancy.runIdentity(input.userId, (tx) =>
      tx.device.create({
        data: {
          userId: input.userId,
          schoolId: input.profile.schoolId,
          activeProfileId: input.profile.id,
          platform: input.platform ?? null,
          refreshTokenHash: sha256(secret),
          lastSeenAt: new Date(),
        },
        select: { id: true },
      }),
    );

    return {
      deviceId: device.id,
      refreshToken: `${REFRESH_PREFIX}.${input.userId}.${device.id}.${secret}`,
    };
  }

  /**
   * Rotation du jeton de rafraîchissement.
   * Un secret qui ne correspond pas au hash stocké est traité comme une
   * réutilisation : l'appareil est révoqué immédiatement (CDC §8 S-2).
   */
  async rotateSession(rawToken: string): Promise<RotatedSession> {
    const parts = rawToken.split(".");
    if (parts.length !== 4 || parts[0] !== REFRESH_PREFIX) {
      throw new UnauthorizedException("Jeton de rafraîchissement invalide.");
    }

    const userId = parts[1];
    const deviceId = parts[2];
    const secret = parts[3];

    if (!userId || !deviceId || !secret) {
      throw new UnauthorizedException("Jeton de rafraîchissement invalide.");
    }

    const device = await this.tenancy.runIdentity(userId, (tx) =>
      tx.device.findFirst({
        where: { id: deviceId, userId },
        select: {
          id: true,
          userId: true,
          schoolId: true,
          activeProfileId: true,
          status: true,
          refreshTokenHash: true,
          platform: true,
          lastSeenAt: true,
          createdAt: true,
        },
      }),
    );

    if (!device) {
      throw new UnauthorizedException("Session inconnue.");
    }

    if (device.status !== "active") {
      throw new UnauthorizedException("Session révoquée.");
    }

    // CDC 3.4 : une session inactive ne se prolonge pas par rafraîchissement.
    if (this.isIdleDevice(device, new Date())) {
      await this.expireIdle(userId, device);
    }

    if (!safeEqual(device.refreshTokenHash, sha256(secret))) {
      // Réutilisation détectée : on révoque sans révéler la raison exacte.
      await this.revokeDevice(userId, device.id);
      throw new UnauthorizedException("Session révoquée. Reconnectez-vous.");
    }

    const nextSecret = randomToken(32);

    await this.tenancy.runIdentity(userId, (tx) =>
      tx.device.update({
        where: { id: device.id },
        data: { refreshTokenHash: sha256(nextSecret), lastSeenAt: new Date() },
      }),
    );

    return {
      device: {
        id: device.id,
        userId: device.userId,
        schoolId: device.schoolId,
        activeProfileId: device.activeProfileId,
      },
      refreshToken: `${REFRESH_PREFIX}.${userId}.${device.id}.${nextSecret}`,
    };
  }

  /**
   * Lot 10 : un jeton d'accès n'est accepté que si sa session (Device, sid)
   * est encore active. Une déconnexion ou une révocation d'appareil invalide
   * donc immédiatement les jetons d'accès déjà émis. Lecture par clé primaire.
   */
  async assertSessionActive(userId: string, deviceId: string): Promise<void> {
    const device = await this.tenancy.runIdentity(userId, (tx) =>
      tx.device.findFirst({
        where: { id: deviceId, userId, status: "active" },
        select: { id: true, schoolId: true, platform: true, lastSeenAt: true, createdAt: true },
      }),
    );
    if (!device) {
      throw new UnauthorizedException("Session expirée ou révoquée. Reconnectez-vous.");
    }
    const now = new Date();
    // CDC 3.4 (t92) : déconnexion des sessions inactives.
    if (this.isIdleDevice(device, now)) {
      await this.expireIdle(userId, device);
    }
    if (needsTouch(device, now)) {
      await this.tenancy.runIdentity(userId, (tx) =>
        tx.device.updateMany({ where: { id: device.id, status: "active" }, data: { lastSeenAt: now } }),
      );
    }
  }

  private isIdleDevice(device: { platform: string | null; lastSeenAt: Date | null; createdAt: Date }, now: Date): boolean {
    const limit = idleLimitMs(device.platform, {
      SESSION_IDLE_MINUTES: this.config.get<string>("SESSION_IDLE_MINUTES"),
      SESSION_IDLE_MOBILE_MINUTES: this.config.get<string>("SESSION_IDLE_MOBILE_MINUTES"),
    });
    return isIdle(device, limit, now);
  }

  /** Révoque la session inactive, l'audite (sans donnée personnelle) et refuse la requête (401). */
  private async expireIdle(
    userId: string,
    device: { id: string; schoolId: string | null; platform: string | null; lastSeenAt: Date | null; createdAt: Date },
  ): Promise<never> {
    const revoked = await this.tenancy.runIdentity(userId, async (tx) => {
      const res = await tx.device.updateMany({
        where: { id: device.id, status: "active" },
        data: { status: "revoked", revokedAt: new Date(), refreshTokenHash: sha256(randomToken(16)) },
      });
      if (res.count === 1) {
        await tx.auditLog.create({
          data: {
            actorId: userId,
            schoolId: null,
            action: "auth.session.idle_expired",
            entity: "Device",
            entityId: device.id,
            severity: "info",
            metadata: {
              platform: device.platform ?? "inconnue",
              lastActivity: (device.lastSeenAt ?? device.createdAt).toISOString(),
            },
          },
        });
      }
      return res.count;
    });
    void revoked;
    throw new UnauthorizedException("Session expirée après une période d'inactivité. Reconnectez-vous.");
  }

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    await this.tenancy.runIdentity(userId, (tx) =>
      tx.device.update({
        where: { id: deviceId },
        data: {
          status: "revoked",
          revokedAt: new Date(),
          // Le hash est remplacé pour qu'aucun jeton en circulation ne puisse
          // retrouver une correspondance après révocation.
          refreshTokenHash: sha256(randomToken(16)),
        },
      }),
    );
  }

  async listDevices(userId: string, currentDeviceId: string) {
    return this.tenancy
      .runIdentity(userId, (tx) =>
        tx.device.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            platform: true,
            status: true,
            createdAt: true,
            lastSeenAt: true,
            revokedAt: true,
          },
        }),
      )
      .then((devices) =>
        devices.map((device) => ({ ...device, current: device.id === currentDeviceId })),
      );
  }
}
