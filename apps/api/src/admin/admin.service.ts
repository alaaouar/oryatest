import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import argon2 from "argon2";
import { PrismaService } from "../core/prisma.service";
import { TenancyService, type TenantContext } from "../core/tenancy.service";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { ActivationService } from "../activation/activation.service";
import type { CreateSchoolAdminDto, CreateSchoolDto } from "../activation/activation.dto";

/**
 * Opérations réservées au super-admin ORYA (CDC §4 M10) : création et validation
 * d'un établissement, attribution de comptes administrateurs / direction, sans nouveau déploiement.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly activation: ActivationService,
  ) {}

  private superContext(auth: AuthContext): TenantContext {
    return {
      userId: auth.userId,
      profileId: auth.profileId,
      schoolId: null,
      isSuperAdmin: true,
    };
  }

  private hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  private generatePassword(): string {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let pwd = "";
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd + "!Orya26";
  }

  async createSchool(auth: AuthContext, dto: CreateSchoolDto, client: ClientInfo) {
    const context = this.superContext(auth);

    let code = ActivationService.generateSchoolCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const taken = await this.tenancy.run(context, (tx) =>
        tx.school.findUnique({ where: { code }, select: { id: true } }),
      );
      if (!taken) {
        break;
      }
      code = ActivationService.generateSchoolCode();
    }

    const existing = await this.tenancy.run(context, (tx) =>
      tx.school.findFirst({ where: { name: dto.name }, select: { id: true } }),
    );
    if (existing) {
      throw new ConflictException("Un établissement porte déjà ce nom.");
    }

    const schoolStatus = dto.status ?? (dto.adminEmail ? "active" : "pending");

    const school = await this.tenancy.run(context, (tx) =>
      tx.school.create({
        data: {
          name: dto.name,
          city: dto.city,
          ice: dto.ice ?? null,
          code,
          status: schoolStatus,
        },
        select: { id: true, name: true, city: true, ice: true, code: true, status: true, createdAt: true },
      }),
    );

    const trialEndsAt = new Date();
    trialEndsAt.setFullYear(trialEndsAt.getFullYear() + 1);

    await this.tenancy.run(context, (tx) =>
      tx.subscription.create({
        data: { schoolId: school.id, status: "trial", trialEndsAt },
      }),
    );

    let adminResult: {
      profileId: string;
      userId: string;
      email: string;
      displayName: string;
      initialPassword?: string;
    } | null = null;

    if (dto.adminEmail?.trim()) {
      adminResult = await this.createSchoolAdmin(
        auth,
        school.id,
        {
          email: dto.adminEmail.trim(),
          displayName: dto.adminName?.trim() || `Direction ${dto.name}`,
          password: dto.adminPassword?.trim() || undefined,
        },
        client,
      );
    }

    await this.audit.scoped(context, {
      action: "school.created",
      entity: "School",
      entityId: school.id,
      severity: "critical",
      metadata: { code: school.code, adminEmail: dto.adminEmail ?? null, status: school.status },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return {
      ...school,
      admin: adminResult,
    };
  }

  /**
   * Crée ou rattache un administrateur / directeur d'établissement (rôle "direction").
   */
  async createSchoolAdmin(
    auth: AuthContext,
    schoolId: string,
    dto: CreateSchoolAdminDto,
    client: ClientInfo,
  ) {
    const context = this.superContext(auth);
    const email = dto.email.trim().toLowerCase();
    const displayName = dto.displayName.trim();
    const rawPassword = dto.password?.trim() || this.generatePassword();

    const school = await this.tenancy.run(context, (tx) =>
      tx.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, status: true },
      }),
    );
    if (!school) {
      throw new NotFoundException("Établissement introuvable.");
    }

    let user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, activeProfileId: true },
    });
    let isNewUser = false;

    if (user) {
      const existingProfile = await this.tenancy.run(context, (tx) =>
        tx.userProfile.findFirst({
          where: { userId: user!.id, schoolId, role: "direction" },
          select: { id: true },
        }),
      );
      if (existingProfile) {
        throw new ConflictException("Cet utilisateur est déjà administrateur de cet établissement.");
      }
    } else {
      const passwordHash = await this.hashPassword(rawPassword);
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          locale: "fr",
          status: "active",
        },
        select: { id: true, email: true, activeProfileId: true },
      });
      isNewUser = true;
    }

    const profile = await this.tenancy.run(context, (tx) =>
      tx.userProfile.create({
        data: {
          userId: user!.id,
          schoolId,
          role: "direction",
          displayName,
        },
        select: { id: true, role: true, displayName: true, schoolId: true, createdAt: true },
      }),
    );

    if (!user.activeProfileId) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { activeProfileId: profile.id },
        select: { id: true },
      });
    }

    await this.audit.scoped(context, {
      action: "school.admin.created",
      entity: "UserProfile",
      entityId: profile.id,
      severity: "critical",
      metadata: { schoolId, schoolName: school.name, email, role: "direction" },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return {
      profileId: profile.id,
      userId: user.id,
      email,
      displayName: profile.displayName,
      schoolId,
      initialPassword: isNewUser ? rawPassword : (dto.password?.trim() || undefined),
    };
  }

  /** Liste des etablissements, abonnement et comptes administrateurs inclus (console super-admin). */
  async listSchools(auth: AuthContext) {
    return this.tenancy.run(this.superContext(auth), (tx) =>
      tx.school.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          city: true,
          ice: true,
          code: true,
          status: true,
          createdAt: true,
          subscription: {
            select: { status: true, pricePerChildMad: true, trialEndsAt: true },
          },
          profiles: {
            where: { role: "direction" },
            select: {
              id: true,
              displayName: true,
              role: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  status: true,
                  lastLoginAt: true,
                },
              },
            },
          },
        },
      }),
    );
  }

  async validateSchool(auth: AuthContext, schoolId: string, client: ClientInfo) {
    const context = this.superContext(auth);

    const school = await this.tenancy.run(context, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { id: true, status: true } }),
    );

    if (!school) {
      throw new NotFoundException("Établissement introuvable.");
    }

    const updated = await this.tenancy.run(context, (tx) =>
      tx.school.update({
        where: { id: schoolId },
        data: { status: "active" },
        select: { id: true, name: true, code: true, status: true },
      }),
    );

    await this.audit.scoped(context, {
      action: "school.validated",
      entity: "School",
      entityId: schoolId,
      severity: "critical",
      metadata: { previousStatus: school.status },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return updated;
  }

  async invite(auth: AuthContext, dto: { role: "teacher" | "bus_attendant" | "chauffeur"; email: string }, client: ClientInfo) {
    if (!auth.schoolId) {
      throw new NotFoundException("Aucun établissement actif dans la session.");
    }

    return this.activation.createInvitation({
      schoolId: auth.schoolId,
      role: dto.role,
      email: dto.email,
      createdById: auth.userId,
      profileId: auth.profileId,
      client,
    });
  }
}
