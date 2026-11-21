import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import argon2 from "argon2";
import { AuditService } from "../audit/audit.service";
import type { ClientInfo } from "./auth.service";
import { randomToken, sha256 } from "../core/crypto";
import { PrismaService } from "../core/prisma.service";
import { TenancyService } from "../core/tenancy.service";
import { MAILER, type Mailer } from "../mail/mailer";
import { readCredentials } from "./auth-lookup.sql";
import { passwordPolicyProblems } from "./password-policy";
import {
  formatResetToken,
  parseResetToken,
  RESET_ACCOUNT_WINDOW_MS,
  RESET_REQUEST_RESPONSE,
  resetAccountLimit,
  resetLink,
  resetTokenStatus,
  resetTtlMinutes,
} from "./password-reset.rules";

const INVALID_LINK = "Lien de reinitialisation invalide ou expire. Faites une nouvelle demande.";

/**
 * F01 (t87u) : mot de passe oublie (canal e-mail ; SMS interdit par le CDC).
 *  - reponse identique que le compte existe ou non ; plafond par IP (controleur) et par compte ;
 *  - jeton a usage unique, SHA-256 en base, expiration 30 min (PASSWORD_RESET_TTL_MINUTES) ;
 *  - succes : politique ebe40ca, nouveau hash, compteur d'echecs remis a zero, TOUTES les
 *    sessions revoquees, autres jetons invalides, audit critique ;
 *  - aucun e-mail ni jeton dans les journaux ni dans l'audit ;
 *  - production sans fournisseur d'e-mail : 503 pour toute demande (echec ferme).
 */
@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async request(rawEmail: string, client: ClientInfo) {
    if (!this.mailer.configured) {
      throw new ServiceUnavailableException("Reinitialisation indisponible : aucun fournisseur d'e-mail n'est configure.");
    }
    const email = rawEmail.trim().toLowerCase();
    const cred = await readCredentials(this.prisma, email);
    if (!cred || !cred.found || !cred.user_id || cred.status !== "active") {
      // Meme travail cryptographique que pour un compte existant (duree comparable).
      sha256(formatResetToken("00000000-0000-0000-0000-000000000000", randomToken(32)));
      return RESET_REQUEST_RESPONSE;
    }
    const userId = cred.user_id;
    const ttl = resetTtlMinutes(process.env.PASSWORD_RESET_TTL_MINUTES);
    const limit = resetAccountLimit(process.env.PASSWORD_RESET_ACCOUNT_LIMIT);
    const token = formatResetToken(userId, randomToken(32));
    const created = await this.tenancy.runIdentity(userId, async (tx) => {
      const recent = await tx.passwordResetToken.count({
        where: { userId, createdAt: { gt: new Date(Date.now() - RESET_ACCOUNT_WINDOW_MS) } },
      });
      if (recent >= limit) return false;
      await tx.passwordResetToken.create({
        data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttl * 60_000) },
        select: { id: true },
      });
      return true;
    });
    if (!created) {
      await this.audit.session(userId, {
        action: "auth.password.reset_throttled", entity: "User", entityId: userId, severity: "warning",
        metadata: { limitPerHour: limit }, ip: client.ip, userAgent: client.userAgent,
      });
      return RESET_REQUEST_RESPONSE;
    }
    const webOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";
    await this.mailer.send({
      kind: "password_reset",
      to: email,
      subject: "ORYA - reinitialisation de votre mot de passe",
      text: [
        "Bonjour,",
        "",
        "Une reinitialisation du mot de passe de votre compte ORYA a ete demandee.",
        `Pour choisir un nouveau mot de passe, ouvrez ce lien (valable ${ttl} minutes, utilisable une seule fois) :`,
        resetLink(webOrigin, token),
        "",
        "Si vous n'etes pas a l'origine de cette demande, ignorez ce message : votre mot de passe reste inchange.",
      ].join("\n"),
    });
    await this.audit.session(userId, {
      action: "auth.password.reset_requested", entity: "User", entityId: userId, severity: "info",
      metadata: { channel: "email", ttlMinutes: ttl }, ip: client.ip, userAgent: client.userAgent,
    });
    return RESET_REQUEST_RESPONSE;
  }

  async confirm(rawToken: string, newPassword: string, client: ClientInfo) {
    const parsed = parseResetToken(rawToken);
    if (!parsed) throw new BadRequestException(INVALID_LINK);
    const { userId } = parsed;
    const tokenHash = sha256(rawToken.trim());
    const now = new Date();
    const row = await this.tenancy.runIdentity(userId, (tx) =>
      tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { id: true, userId: true, usedAt: true, expiresAt: true } }),
    );
    const status = resetTokenStatus(row && row.userId === userId ? row : null, now);
    const pub = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true } });
    if (status !== "valid" || !pub || pub.status !== "active") {
      if (pub && status !== "unknown") {
        await this.audit.session(userId, {
          action: "auth.password.reset_failed", entity: "User", entityId: userId, severity: "warning",
          metadata: { reason: status }, ip: client.ip, userAgent: client.userAgent,
        });
      }
      throw new BadRequestException(INVALID_LINK);
    }
    const problems = passwordPolicyProblems(newPassword, { email: pub.email, current: "" });
    const cred = await readCredentials(this.prisma, pub.email);
    if (cred?.password_hash && (await argon2.verify(cred.password_hash, newPassword).catch(() => false))) {
      problems.push("Le nouveau mot de passe doit etre different de l'actuel.");
    }
    if (problems.length > 0) throw new BadRequestException(problems);
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
      parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
    });
    // Tout ou rien : consommation conditionnelle du jeton (course entre deux onglets),
    // autres jetons invalides, nouveau hash, revocation de TOUTES les sessions.
    const revoked = await this.tenancy.runIdentity(userId, async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({ where: { id: row!.id, usedAt: null }, data: { usedAt: now } });
      if (consumed.count !== 1) return null;
      await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
      const devices = await tx.device.findMany({ where: { userId, status: "active" }, select: { id: true } });
      for (const device of devices) {
        await tx.device.update({
          where: { id: device.id },
          data: { status: "revoked", revokedAt: now, refreshTokenHash: sha256(randomToken(16)) },
          select: { id: true },
        });
      }
      await tx.user.update({ where: { id: userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null }, select: { id: true } });
      return devices.length;
    });
    if (revoked === null) throw new BadRequestException(INVALID_LINK);
    await this.audit.session(userId, {
      action: "auth.password.reset", entity: "User", entityId: userId, severity: "critical",
      metadata: { revokedSessions: revoked, channel: "email" }, ip: client.ip, userAgent: client.userAgent,
    });
    return { ok: true, revokedSessions: revoked };
  }
}