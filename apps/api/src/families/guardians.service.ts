import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ActivationService } from "../activation/activation.service";
import { AuditService } from "../audit/audit.service";
import type { ClientInfo } from "../auth/auth.service";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import { TenancyService } from "../core/tenancy.service";
import type { GuardianInputDto, LinkStudentDto, UpdateGuardianDto } from "./families.dto";

/** Plafond fixé par la base (trigger ORYA_MAX_GUARDIANS) : 2 responsables par élève. */
const MAX_GUARDIANS_PER_STUDENT = 2;

const GUARDIAN_SELECT = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  phoneSecondary: true,
  address: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  students: {
    orderBy: { createdAt: "asc" },
    select: {
      relationship: true,
      isPrimary: true,
      student: { select: { id: true, displayName: true, studentCode: true } },
    },
  },
  invitations: {
    where: { role: "parent", usedAt: null },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, expiresAt: true, createdAt: true },
  },
} satisfies Prisma.GuardianSelect;

type GuardianRow = Prisma.GuardianGetPayload<{ select: typeof GUARDIAN_SELECT }>;

/**
 * Responsables légaux (Lot 3) : CRUD, liens élèves (plusieurs enfants par
 * responsable, 2 responsables max par élève), invitations parent.
 * Réservé à la direction ; schoolId issu du jeton, RLS active.
 */
@Injectable()
export class GuardiansService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly activation: ActivationService,
  ) {}

  async list(auth: AuthContext, search?: string) {
    requireSchool(auth);
    const needle = search?.trim();
    const rows = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.guardian.findMany({
        where: needle
          ? {
              OR: [
                { fullName: { contains: needle, mode: "insensitive" } },
                { email: { contains: needle, mode: "insensitive" } },
                { phone: { contains: needle } },
                { students: { some: { student: { displayName: { contains: needle, mode: "insensitive" } } } } },
              ],
            }
          : {},
        orderBy: { fullName: "asc" },
        take: 500,
        select: GUARDIAN_SELECT,
      }),
    );
    return rows.map(toView);
  }

  async get(auth: AuthContext, guardianId: string) {
    requireSchool(auth);
    const row = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.guardian.findFirst({ where: { id: guardianId }, select: GUARDIAN_SELECT }),
    );
    if (!row) throw new NotFoundException("Responsable introuvable.");
    return toView(row);
  }

  async create(auth: AuthContext, dto: GuardianInputDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);
    const email = normalizeEmail(dto.email);

    const created = await this.tenancy.run(context, async (tx) => {
      if (email) {
        const duplicate = await tx.guardian.findFirst({ where: { email }, select: { id: true } });
        if (duplicate) {
          throw new ConflictException("Un responsable avec cet e-mail existe déjà dans l'établissement.");
        }
      }
      return tx.guardian.create({
        data: {
          schoolId,
          fullName: dto.fullName.trim(),
          email,
          phone: emptyToNull(dto.phone),
          phoneSecondary: emptyToNull(dto.phoneSecondary),
          address: emptyToNull(dto.address),
        },
        select: GUARDIAN_SELECT,
      });
    });

    await this.audit.scoped(context, {
      action: "guardian.created",
      entity: "Guardian",
      entityId: created.id,
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return toView(created);
  }

  async update(auth: AuthContext, guardianId: string, dto: UpdateGuardianDto, client: ClientInfo) {
    requireSchool(auth);
    const context = toTenantContext(auth);
    const data: Prisma.GuardianUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.email !== undefined) data.email = normalizeEmail(dto.email);
    if (dto.phone !== undefined) data.phone = emptyToNull(dto.phone);
    if (dto.phoneSecondary !== undefined) data.phoneSecondary = emptyToNull(dto.phoneSecondary);
    if (dto.address !== undefined) data.address = emptyToNull(dto.address);
    if (Object.keys(data).length === 0) throw new BadRequestException("Aucune modification fournie.");

    const updated = await this.tenancy.run(context, async (tx) => {
      const existing = await tx.guardian.findFirst({
        where: { id: guardianId },
        select: { id: true, userId: true, email: true },
      });
      if (!existing) throw new NotFoundException("Responsable introuvable.");
      if (existing.userId && dto.email !== undefined && normalizeEmail(dto.email) !== existing.email) {
        throw new ConflictException(
          "Ce responsable a déjà un compte : son e-mail de connexion ne peut pas être modifié ici.",
        );
      }
      if (typeof data.email === "string") {
        const duplicate = await tx.guardian.findFirst({
          where: { email: data.email, id: { not: guardianId } },
          select: { id: true },
        });
        if (duplicate) {
          throw new ConflictException("Un responsable avec cet e-mail existe déjà dans l'établissement.");
        }
      }
      return tx.guardian.update({ where: { id: guardianId }, data, select: GUARDIAN_SELECT });
    });

    await this.audit.scoped(context, {
      action: "guardian.updated",
      entity: "Guardian",
      entityId: guardianId,
      metadata: { fields: Object.keys(data) },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return toView(updated);
  }

  async link(auth: AuthContext, guardianId: string, dto: LinkStudentDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const context = toTenantContext(auth);

    const result = await this.tenancy.run(context, async (tx) => {
      const guardian = await tx.guardian.findFirst({ where: { id: guardianId }, select: { id: true, fullName: true } });
      if (!guardian) throw new NotFoundException("Responsable introuvable.");
      const student = await tx.student.findFirst({
        where: { id: dto.studentId },
        select: { id: true, displayName: true },
      });
      if (!student) throw new NotFoundException("Élève introuvable.");

      const existing = await tx.studentGuardian.findFirst({
        where: { studentId: student.id, guardianId },
        select: { id: true },
      });
      if (existing) throw new ConflictException("Ce responsable est déjà rattaché à cet élève.");

      const count = await tx.studentGuardian.count({ where: { studentId: student.id } });
      if (count >= MAX_GUARDIANS_PER_STUDENT) {
        throw new ConflictException("Cet élève a déjà deux responsables : retirez-en un avant d'en ajouter.");
      }

      const isPrimary = dto.isPrimary ?? count === 0;
      if (isPrimary) {
        await tx.studentGuardian.updateMany({ where: { studentId: student.id }, data: { isPrimary: false } });
      }
      await tx.studentGuardian.create({
        data: {
          schoolId,
          studentId: student.id,
          guardianId,
          relationship: dto.relationship?.trim() || null,
          isPrimary,
        },
      });
      return { student, guardian };
    });

    await this.audit.scoped(context, {
      action: "student.guardian.linked",
      entity: "Student",
      entityId: dto.studentId,
      metadata: { guardianId, guardianName: result.guardian.fullName, relationship: dto.relationship ?? null },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return this.get(auth, guardianId);
  }

  async unlink(auth: AuthContext, guardianId: string, studentId: string, client: ClientInfo) {
    requireSchool(auth);
    const context = toTenantContext(auth);
    const removed = await this.tenancy.run(context, (tx) =>
      tx.studentGuardian.deleteMany({ where: { guardianId, studentId } }),
    );
    if (removed.count === 0) throw new NotFoundException("Lien responsable-élève introuvable.");

    await this.audit.scoped(context, {
      action: "student.guardian.unlinked",
      entity: "Student",
      entityId: studentId,
      severity: "warning",
      metadata: { guardianId },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return this.get(auth, guardianId);
  }

  /**
   * Invitation parent rattachée à un responsable existant : à l'acceptation,
   * le compte créé est lié au responsable et voit tous ses enfants.
   * Aucun fournisseur e-mail : le lien est remis une fois à l'école.
   */
  async invite(auth: AuthContext, guardianId: string, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const guardian = await this.tenancy.run(toTenantContext(auth), (tx) =>
      tx.guardian.findFirst({
        where: { id: guardianId },
        select: { id: true, email: true, userId: true, _count: { select: { students: true } } },
      }),
    );
    if (!guardian) throw new NotFoundException("Responsable introuvable.");
    if (guardian.userId) throw new ConflictException("Ce responsable a déjà un compte actif.");
    if (!guardian.email) {
      throw new BadRequestException("Renseignez l'e-mail du responsable avant de l'inviter.");
    }
    if (guardian._count.students === 0) {
      throw new BadRequestException("Rattachez au moins un élève avant d'inviter le responsable.");
    }

    return this.activation.createInvitation({
      schoolId,
      role: "parent",
      email: guardian.email,
      guardianId: guardian.id,
      createdById: auth.userId,
      profileId: auth.profileId,
      client,
    });
  }
}

function toView(row: GuardianRow) {
  const pending = row.invitations[0];
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    phoneSecondary: row.phoneSecondary,
    address: row.address,
    hasAccount: !!row.userId,
    pendingInvitation:
      pending && pending.expiresAt.getTime() > Date.now()
        ? { id: pending.id, expiresAt: pending.expiresAt, createdAt: pending.createdAt }
        : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    students: row.students.map((link) => ({
      id: link.student.id,
      displayName: link.student.displayName,
      studentCode: link.student.studentCode,
      relationship: link.relationship,
      isPrimary: link.isPrimary,
    })),
  };
}

function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) throw new ForbiddenException("Un établissement actif est requis.");
  return auth.schoolId;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(value: string | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
