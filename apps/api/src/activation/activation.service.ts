import { PlanLimitsService } from "../billing/plan-limits.service";
import { randomInt } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { ProfileRole } from "@prisma/client";
import argon2 from "argon2";
import { randomToken, sha256 } from "../core/crypto";
import { formatActivationCode, generateActivationCode, normalizeActivationCode } from "../core/activation-code";
import { PrismaService } from "../core/prisma.service";
import { TenancyService } from "../core/tenancy.service";
import { AuditService } from "../audit/audit.service";
import { TokenService } from "../auth/token.service";
import { MFA_REQUIRED_ROLES } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AttemptThrottleService } from "./attempt-throttle.service";
import type { ActivateParentDto, AcceptInvitationDto } from "./activation.dto";

const INVITATION_PREFIX = "inv";
const INVITATION_TTL_DAYS = 7;

function hashCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return code;
}

/**
 * Activation d'un accès (CDC §3.2).
 *
 * Principe : le choix d'un profil ne donne aucun droit. L'accès n'existe qu'après
 *   1. validation de l'établissement par ORYA (école en attente = connexion refusée) ;
 *   2. preuve de rattachement : code établissement + code élève, ou invitation.
 *
 * Un compte créé par activation est actif, mais l'école doit être active pour que
 * la connexion aboutisse (contrôle fait dans AuthService).
 */
@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly throttle: AttemptThrottleService,
    private readonly limits: PlanLimitsService,
  ) {}

  // -------------------------------------------------------------------------
  // Parent : code établissement + code élève
  // -------------------------------------------------------------------------

  async activateParent(dto: ActivateParentDto, client: ClientInfo, throttleKey: string) {
    this.throttle.assertNotLocked(throttleKey);

    const schoolCode = dto.schoolCode.toUpperCase();
    const school = await this.tenancy.runSchoolCode(schoolCode, (tx) =>
      tx.school.findUnique({
        where: { code: schoolCode },
        select: { id: true, name: true, status: true },
      }),
    );

    if (!school) {
      this.throttle.registerFailure(throttleKey);
      await this.audit.attempt({
        schoolId: null,
        action: "activation.parent.failed",
        entity: "School",
        metadata: { reason: "school_code_unknown" },
        ip: client.ip,
        userAgent: client.userAgent,
      });
      // Message identique quel que soit le motif : pas d'oracle d'énumération.
      throw new NotFoundException("Code établissement ou code d'activation invalide.");
    }

    if (school.status !== "active") {
      throw new ForbiddenException(
        "Cet établissement est en attente de validation par ORYA. L'accès sera ouvert après validation.",
      );
    }

    const code = normalizeActivationCode(dto.activationCode);
    const student = await this.tenancy.runSchool(school.id, (tx) =>
      tx.student.findFirst({
        where: { schoolId: school.id, activationCodeHash: sha256(code) },
        select: { id: true, displayName: true, activationCodeExpiresAt: true },
      }),
    );

    const expired =
      !student ||
      !student.activationCodeExpiresAt ||
      student.activationCodeExpiresAt.getTime() < Date.now();

    if (expired) {
      this.throttle.registerFailure(throttleKey);
      await this.audit.attempt({
        schoolId: school.id,
        action: "activation.parent.failed",
        entity: "Student",
        entityId: student?.id ?? null,
        metadata: { reason: student ? "code_expired" : "code_invalid" },
        ip: client.ip,
        userAgent: client.userAgent,
      });
      throw new NotFoundException("Code établissement ou code d'activation invalide.");
    }

    const guardians = await this.tenancy.runSchool(school.id, (tx) =>
      tx.studentGuardian.count({ where: { studentId: student.id } }),
    );

    if (guardians >= 2) {
      throw new ConflictException(
        "Cet élève a déjà deux responsables. Contactez l'établissement pour toute modification.",
      );
    }

    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new ConflictException(
        "Un compte existe déjà avec cet e-mail. Connectez-vous, ou utilisez un autre e-mail.",
      );
    }

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, locale: "fr", status: "active" },
      select: { id: true },
    });

    const profile = await this.tenancy.runOnboarding(user.id, school.id, async (tx) => {
      const created = await tx.userProfile.create({
        data: {
          userId: user.id,
          schoolId: school.id,
          role: "parent",
          displayName: dto.fullName,
        },
        select: { id: true, role: true, schoolId: true, displayName: true },
      });

      const guardian = await tx.guardian.create({
        data: {
          schoolId: school.id,
          userId: user.id,
          fullName: dto.fullName,
          email,
        },
        select: { id: true },
      });

      await tx.studentGuardian.create({
        data: {
          schoolId: school.id,
          studentId: student.id,
          guardianId: guardian.id,
          relationship: dto.relationship ?? null,
          isPrimary: true,
        },
      });

      await tx.user.update({ select: { id: true }, where: { id: user.id }, data: { activeProfileId: created.id } });

      return created;
    });

    await this.audit.scoped(
      {
        userId: user.id,
        profileId: profile.id,
        schoolId: school.id,
        isSuperAdmin: false,
      },
      {
        action: "activation.parent.completed",
        entity: "Student",
        entityId: student.id,
        metadata: { schoolId: school.id },
        ip: client.ip,
        userAgent: client.userAgent,
      },
    );

    this.throttle.registerSuccess(throttleKey);
    return this.issueSession(user.id, profile, school.name, client);
  }

  // -------------------------------------------------------------------------
  // Invitation : enseignant, accompagnateur
  // -------------------------------------------------------------------------

  async createInvitation(input: {
    schoolId: string;
    role: "teacher" | "bus_attendant" | "chauffeur" | "parent" | "student";
    email: string;
    /** Bloc 4 : invitation eleve rattachee a sa fiche (consentement parental actif requis). */
    studentId?: string;
    /** Lot 3 : invitation parent liée à un responsable existant. */
    guardianId?: string;
    createdById: string;
    profileId: string;
    client: ClientInfo;
  }) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new ConflictException("Un compte existe déjà avec cet e-mail.");
    }

    const secret = randomToken(24);
    const token = `${INVITATION_PREFIX}.${input.schoolId}.${secret}`;
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000);

    const invitation = await this.tenancy.runSchool(input.schoolId, async (tx) => {
      // Lot 9 : statut d'abonnement et limite de comptes personnel du plan.
      await this.limits.assertWritable(tx, input.schoolId);
      if (input.role === "teacher" || input.role === "bus_attendant" || input.role === "chauffeur") await this.limits.assertCapacity(tx, input.schoolId, "staff", 1);
      return tx.invitation.create({
        data: {
          schoolId: input.schoolId,
          role: input.role,
          email,
          tokenHash: sha256(secret),
          expiresAt,
          createdById: input.createdById,
          guardianId: input.guardianId ?? null,
          studentId: input.studentId ?? null,
        },
        select: { id: true, expiresAt: true },
      });
    });

    await this.audit.scoped(
      {
        userId: input.createdById,
        profileId: input.profileId,
        schoolId: input.schoolId,
        isSuperAdmin: false,
      },
      {
        action: "invitation.created",
        entity: "Invitation",
        entityId: invitation.id,
        metadata: { role: input.role },
        ip: input.client.ip,
        userAgent: input.client.userAgent,
      },
    );

    // Aucun fournisseur e-mail n'est branché : le jeton est remis une seule fois
    // à l'école, qui le transmet par son canal habituel.
    return { invitationId: invitation.id, token, expiresAt: invitation.expiresAt };
  }

  async acceptInvitation(dto: AcceptInvitationDto, client: ClientInfo, throttleKey: string) {
    this.throttle.assertNotLocked(throttleKey);

    try {
      const session = await this.acceptInvitationUnsafe(dto, client);
      this.throttle.registerSuccess(throttleKey);
      return session;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.throttle.registerFailure(throttleKey);
        await this.audit.attempt({
          schoolId: this.schoolIdFromToken(dto.token),
          action: "activation.invitation.failed",
          entity: "Invitation",
          metadata: { reason: "invalid_or_expired" },
          ip: client.ip,
          userAgent: client.userAgent,
        });
      }
      throw error;
    }
  }

  private async acceptInvitationUnsafe(dto: AcceptInvitationDto, client: ClientInfo) {
    const parts = dto.token.split(".");
    if (parts.length !== 3 || parts[0] !== INVITATION_PREFIX) {
      throw new UnauthorizedException("Invitation invalide.");
    }

    const schoolId = parts[1];
    const secret = parts[2];

    if (!schoolId || !secret) {
      throw new UnauthorizedException("Invitation invalide.");
    }

    const school = await this.tenancy.runSchool(schoolId, (tx) =>
      tx.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, status: true },
      }),
    );

    if (!school) {
      throw new UnauthorizedException("Invitation invalide.");
    }
    if (school.status !== "active") {
      throw new ForbiddenException(
        "Cet établissement est en attente de validation par ORYA. L'invitation reste valable.",
      );
    }

    const invitation = await this.tenancy.runSchool(schoolId, (tx) =>
      tx.invitation.findFirst({
        where: { schoolId, tokenHash: sha256(secret) },
        select: { id: true, role: true, email: true, expiresAt: true, usedAt: true, guardianId: true, studentId: true },
      }),
    );

    if (!invitation || invitation.usedAt || invitation.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException("Invitation invalide ou expirée.");
    }
    if (!invitation.email) {
      throw new UnauthorizedException("Invitation sans destinataire.");
    }

    const email = invitation.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new ConflictException("Un compte existe déjà avec cet e-mail.");
    }

    // Bloc 4 : un compte eleve n'est cree que si sa fiche a un consentement parental actif.
    if (invitation.role === "student") {
      const student = invitation.studentId
        ? await this.tenancy.runSchool(schoolId, (tx) =>
            tx.student.findFirst({ where: { id: invitation.studentId!, schoolId }, select: { accountStatus: true } }),
          )
        : null;
      if (!student || student.accountStatus !== "active") {
        throw new ForbiddenException("Compte eleve indisponible : consentement parental actif requis.");
      }
    }

    const passwordHash = await this.hashPassword(dto.password);
    const user = await this.prisma.user.create({
      data: { email, passwordHash, locale: dto.locale ?? "fr", status: "active" },
      select: { id: true },
    });

    const profile = await this.tenancy.runOnboarding(user.id, schoolId, async (tx) => {
      const created = await tx.userProfile.create({
        data: {
          userId: user.id,
          schoolId,
          role: invitation.role,
          displayName: dto.fullName ?? email,
          studentId: invitation.role === "student" ? invitation.studentId : null,
        },
        select: { id: true, role: true, schoolId: true, displayName: true },
      });

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      });

      // Lot 3 : le compte parent est rattaché au responsable invité, donc à
      // tous ses enfants. Un responsable déjà lié à un compte n'est jamais repris.
      if (invitation.role === "parent" && invitation.guardianId) {
        const linked = await tx.guardian.updateMany({
          where: { id: invitation.guardianId, userId: null },
          data: { userId: user.id },
        });
        if (linked.count === 0) {
          throw new ConflictException("Ce responsable est déjà rattaché à un compte.");
        }
      }

      await tx.user.update({ select: { id: true }, where: { id: user.id }, data: { activeProfileId: created.id } });

      return created;
    });

    await this.audit.scoped(
      { userId: user.id, profileId: profile.id, schoolId, isSuperAdmin: false },
      {
        action: "activation.invitation.completed",
        entity: "Invitation",
        entityId: invitation.id,
        metadata: { role: invitation.role },
        ip: client.ip,
        userAgent: client.userAgent,
      },
    );

    return this.issueSession(user.id, profile, school.name, client);
  }

  // -------------------------------------------------------------------------
  // Interne
  // -------------------------------------------------------------------------

  /** Extrait l'école d'un jeton d'invitation sans faire confiance au reste. */
  private schoolIdFromToken(token: string): string | null {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== INVITATION_PREFIX) {
      return null;
    }
    return parts[1] ?? null;
  }

  private async issueSession(
    userId: string,
    profile: { id: string; role: ProfileRole; schoolId: string | null; displayName: string },
    schoolName: string,
    client: ClientInfo,
  ) {
    const session = await this.tokens.createSession({
      userId,
      profile: { id: profile.id, role: profile.role, schoolId: profile.schoolId },
    });

    const accessToken = await this.tokens.signAccess({
      userId,
      profileId: profile.id,
      deviceId: session.deviceId,
      schoolId: profile.schoolId,
      role: profile.role,
      mfa: MFA_REQUIRED_ROLES.has(profile.role),
    });

    return {
      accessToken,
      refreshToken: session.refreshToken,
      profile: {
        id: profile.id,
        role: profile.role,
        schoolId: profile.schoolId,
        schoolName,
        schoolStatus: "active",
        displayName: profile.displayName,
      },
    };
  }

  private hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
      parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
    });
  }

  /** Exposé aux tests et au futur écran d'administration. */
  static generateSchoolCode(): string {
    return hashCode();
  }
}
