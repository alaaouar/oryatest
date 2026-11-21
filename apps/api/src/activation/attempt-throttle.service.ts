import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";

type Bucket = {
  failures: number;
  windowStartedAt: number;
  lockedUntil: number;
};

/**
 * Verrouillage progressif des tentatives d'activation (CDC §8 S-7).
 *
 * Les endpoints d'activation sont publics : sans ce garde-fou, un code
 * d'activation pourrait être deviné par force brute. Le compteur est en mémoire
 * (par IP) ; une instance unique suffit au Lot 1. En multi-instance, remplacer
 * par Redis sans changer l'interface.
 *
 * Paramétrable par environnement :
 *   ACTIVATION_MAX_FAILURES (défaut 10)
 *   ACTIVATION_WINDOW_MINUTES (défaut 15)
 *   ACTIVATION_LOCK_MINUTES (défaut 15)
 */
@Injectable()
export class AttemptThrottleService {
  private readonly logger = new Logger(AttemptThrottleService.name);
  private readonly buckets = new Map<string, Bucket>();

  private readonly maxFailures = Number(process.env.ACTIVATION_MAX_FAILURES ?? 10);
  private readonly windowMs = Number(process.env.ACTIVATION_WINDOW_MINUTES ?? 15) * 60_000;
  private readonly lockMs = Number(process.env.ACTIVATION_LOCK_MINUTES ?? 15) * 60_000;

  /** Lève 429 si la clé est verrouillée. */
  assertNotLocked(key: string): void {
    const bucket = this.buckets.get(key);
    if (!bucket) {
      return;
    }

    const now = Date.now();

    if (bucket.lockedUntil > now) {
      const retryAfter = Math.ceil((bucket.lockedUntil - now) / 1000);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: "Trop de tentatives. Réessayez plus tard.",
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (now - bucket.windowStartedAt > this.windowMs) {
      this.buckets.delete(key);
    }
  }

  /** Enregistre un échec et verrouille au-delà du seuil. */
  registerFailure(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now - bucket.windowStartedAt > this.windowMs) {
      this.buckets.set(key, { failures: 1, windowStartedAt: now, lockedUntil: 0 });
      return;
    }

    bucket.failures += 1;

    if (bucket.failures >= this.maxFailures) {
      bucket.lockedUntil = now + this.lockMs;
      this.logger.warn(
        `Verrouillage activation pour ${key} après ${bucket.failures} échecs (${this.lockMs / 60_000} min).`,
      );
    }
  }

  /** Remet le compteur à zéro après un succès. */
  registerSuccess(key: string): void {
    this.buckets.delete(key);
  }

  /** Utilisé par les tests pour connaître l'état courant. */
  remainingAttempts(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket || Date.now() - bucket.windowStartedAt > this.windowMs) {
      return this.maxFailures;
    }
    return Math.max(0, this.maxFailures - bucket.failures);
  }
}
