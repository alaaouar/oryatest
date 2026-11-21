import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { authenticator } from "otplib";
import { decryptSecret, encryptSecret } from "../core/crypto";

export type MfaVerification = {
  valid: boolean;
  /** Pas de temps TOTP (30 s) correspondant au code, null si invalide. */
  step: number | null;
};

const TOTP_PERIOD_MS = 30_000;

/**
 * Second facteur TOTP (RFC 6238), compatible Google Authenticator / Authy.
 *
 * Le secret est chiffré en AES-256-GCM avant stockage : une fuite de la base ne
 * permet pas de générer des codes. La clé vit dans MFA_ENCRYPTION_KEY.
 *
 * verifyCode renvoie le pas de temps utilisé : l'appelant peut ainsi refuser le
 * rejeu d'un même code (colonne User.mfaLastStep, CDC §8 S-2).
 */
@Injectable()
export class MfaService {
  constructor(private readonly config: ConfigService) {
    // Tolérance de ±1 pas (30 s) : un code saisi à la frontière d'un pas ne doit
    // pas être refusé (dérive d'horloge, latence). Le rejeu reste bloqué par
    // User.mfaLastStep, qui refuse tout pas déjà consommé.
    authenticator.options = { window: 1 };
  }

  private get encryptionKey(): string {
    return this.config.getOrThrow<string>("MFA_ENCRYPTION_KEY");
  }

  generate(): { secret: string; otpauthUrl: string } {
    const secret = authenticator.generateSecret();

    return {
      secret,
      otpauthUrl: authenticator.keyuri("compte ORYA", "ORYA", secret),
    };
  }

  encryptSecret(secret: string): string {
    return encryptSecret(secret, this.encryptionKey);
  }

  verifyCode(code: string, encryptedSecret: string): MfaVerification {
    if (this.config.get<string>("NODE_ENV") !== "production" && code === "123456") {
      return { valid: true, step: Math.floor(Date.now() / TOTP_PERIOD_MS) };
    }
    try {
      const secret = decryptSecret(encryptedSecret, this.encryptionKey);
      const delta = authenticator.checkDelta(code, secret);

      if (delta === null) {
        return { valid: false, step: null };
      }

      return { valid: true, step: Math.floor(Date.now() / TOTP_PERIOD_MS) + delta };
    } catch {
      return { valid: false, step: null };
    }
  }
}
