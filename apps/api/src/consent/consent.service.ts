import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { ConsentChannel, ConsentPurpose, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth.types";
import { toTenantContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { PrismaService } from "../core/prisma.service";
import { TenancyService } from "../core/tenancy.service";
import { consentRequireAllLinkedGuardians } from "./consent.types";
import type { CreateConsentTextDto, GrantParentalConsentDto, PaperParentalConsentDto, ValidateConsentTextDto } from "./consent.dto";

@Injectable()
export class ConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Texte courant pour une finalite/locale. Les brouillons ne sont jamais renvoyes ici.
   * Route HTTP authentifiee : contexte d'identite de l'appelant (runIdentity), jamais
   * runPublic/runSystem (reserves au job et a la CLI, controle statique T15).
   * Policy consent_text_read : lecture des textes VALIDES pour tout contexte,
   * brouillons reserves au super-admin.
   */
  async currentText(auth: AuthContext, purpose: ConsentPurpose, locale: "fr" | "ar") {
    return this.tenancy.runIdentity(auth.userId, async (tx) => {
      const row = await tx.consentText.findFirst({
        where: { purpose, locale, status: "validated", retiredAt: null },
        orderBy: { effectiveAt: "desc" },
        select: { id: true, purpose: true, version: true, locale: true, body: true, bodySha256: true, status: true, effectiveAt: true },
      });
      if (!row) throw new NotFoundException("Aucun texte de consentement valide pour cette finalite.");
      return row;
    });
  }

  async listTexts(auth: AuthContext) {
    if (auth.role !== "super_admin") throw new ForbiddenException();
    return this.tenancy.run(toTenantContext(auth), async (tx) =>
      tx.consentText.findMany({
        orderBy: [{ purpose: "asc" }, { version: "asc" }, { locale: "asc" }],
        select: { id: true, purpose: true, version: true, locale: true, status: true, effectiveAt: true, retiredAt: true, createdAt: true, bodySha256: true },
      }),
    );
  }

  async createText(auth: AuthContext, dto: CreateConsentTextDto) {
    if (auth.role !== "super_admin") throw new ForbiddenException();
    const bodySha256 = createHash("sha256").update(dto.body, "utf8").digest("hex");
    const row = await this.tenancy.run(toTenantContext(auth), async (tx) =>
      tx.consentText.create({
        data: {
          purpose: dto.purpose,
          version: dto.version,
          locale: dto.locale,
          body: dto.body,
          bodySha256,
          status: "draft",
        },
        select: { id: true, purpose: true, version: true, locale: true, status: true, bodySha256: true },
      }),
    );
    await this.audit.session(auth.userId, {
      action: "consent.text.create",
      entity: "ConsentText",
      entityId: row.id,
      severity: "warning",
      metadata: { purpose: dto.purpose, version: dto.version, locale: dto.locale, status: "draft" },
    });
    return row;
  }

  /**
   * Validation juridique d'un texte : super-admin AVEC MFA uniquement (garde
   * @RequireMfa sur la route + controle ici), reference du document de
   * validation juridique et sa date obligatoires, audit critique. Un texte deja
   * valide ne peut pas etre revalide (409) ; le trigger SQL fige la reference.
   */
  async validateText(auth: AuthContext, dto: ValidateConsentTextDto) {
    if (auth.role !== "super_admin") throw new ForbiddenException();
    if (!auth.mfa) throw new ForbiddenException("Authentification renforcee requise pour valider un texte.");
    const legalDate = new Date(`${dto.legalValidatedAt.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(legalDate.getTime())) throw new BadRequestException("Date de validation juridique invalide.");
    if (legalDate.getTime() > Date.now()) throw new BadRequestException("La date de validation juridique ne peut pas etre future.");
    const legalDocumentRef = dto.legalDocumentRef.trim();
    const row = await this.tenancy.run(toTenantContext(auth), async (tx) => {
      const current = await tx.consentText.findUnique({ where: { id: dto.id }, select: { id: true, status: true } });
      if (!current) throw new NotFoundException();
      if (current.status === "validated") throw new ConflictException("Ce texte est deja valide.");
      return tx.consentText.update({
        where: { id: dto.id },
        data: {
          status: "validated",
          effectiveAt: new Date(),
          legalDocumentRef,
          legalValidatedAt: legalDate,
          validatedById: auth.userId,
        },
        select: { id: true, status: true, purpose: true, version: true, locale: true, effectiveAt: true, legalDocumentRef: true, legalValidatedAt: true },
      });
    });
    await this.audit.session(auth.userId, {
      action: "consent.text.validate",
      entity: "ConsentText",
      entityId: dto.id,
      severity: "critical",
      metadata: {
        purpose: row.purpose,
        version: row.version,
        locale: row.locale,
        legalDocumentRef,
        legalValidatedAt: legalDate.toISOString().slice(0, 10),
        mfa: true,
      },
    });
    return row;
  }

  async listForStudent(auth: AuthContext, studentId: string) {
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      await this.assertCanViewStudent(tx, auth, studentId);
      return tx.parentalConsent.findMany({
        where: { studentId },
        orderBy: { grantedAt: "desc" },
        select: {
          id: true, purpose: true, channel: true, grantedAt: true, revokedAt: true,
          guardianId: true, guardianName: true, paperDate: true, paperFileReference: true,
          text: { select: { id: true, version: true, locale: true, status: true, bodySha256: true } },
        },
      });
    });
  }

  async grantByParent(auth: AuthContext, studentId: string, dto: GrantParentalConsentDto, client: ClientInfo) {
    if (auth.role !== "parent") throw new ForbiddenException();
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const link = await this.requireLinkedGuardian(tx, auth, studentId);
      const text = await this.requireValidatedText(tx, dto.textId, dto.purpose);
      const existing = await tx.parentalConsent.findFirst({
        where: { studentId, guardianId: link.guardianId, purpose: dto.purpose, revokedAt: null },
        select: { id: true },
      });
      if (existing) throw new ConflictException("Un consentement actif existe deja pour cet eleve.");
      const row = await tx.parentalConsent.create({
        data: {
          schoolId: auth.schoolId!,
          studentId,
          guardianId: link.guardianId,
          userId: auth.userId,
          purpose: dto.purpose,
          textId: text.id,
          channel: "web",
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
        },
        select: { id: true, grantedAt: true, purpose: true, channel: true, textId: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.userId,
          schoolId: auth.schoolId,
          action: "consent.grant",
          entity: "ParentalConsent",
          entityId: row.id,
          severity: "info",
          metadata: { purpose: dto.purpose, textVersion: text.version, channel: "web", studentId },
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
        },
      });
      await this.recomputeStudentAccountStatus(tx, studentId, auth.userId, client);
      return row;
    });
  }

  /** Canal papier : reserve a la direction. Scan du formulaire : POST .../consents/:id/scan (bloc 3, ConsentScanService). */
  async grantPaper(auth: AuthContext, studentId: string, dto: PaperParentalConsentDto, client: ClientInfo) {
    if (auth.role !== "direction") throw new ForbiddenException("Le canal papier est reserve a la direction.");
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const student = await tx.student.findFirst({ where: { id: studentId, schoolId: auth.schoolId! }, select: { id: true } });
      if (!student) throw new NotFoundException();
      const text = await this.requireValidatedText(tx, dto.textId, dto.purpose);
      const row = await tx.parentalConsent.create({
        data: {
          schoolId: auth.schoolId!,
          studentId,
          guardianId: null,
          userId: auth.userId,
          purpose: dto.purpose,
          textId: text.id,
          channel: "paper_school",
          guardianName: dto.guardianName,
          paperDate: new Date(dto.paperDate),
          paperFileReference: dto.paperFileReference,
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
        },
        select: { id: true, grantedAt: true, purpose: true, channel: true, guardianName: true, paperFileReference: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.userId,
          schoolId: auth.schoolId,
          action: "consent.grant.paper",
          entity: "ParentalConsent",
          entityId: row.id,
          severity: "warning",
          metadata: {
            purpose: dto.purpose,
            textVersion: text.version,
            channel: "paper_school",
            studentId,
            guardianName: dto.guardianName,
            paperFileReference: dto.paperFileReference,
            paperDate: dto.paperDate,
          },
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
        },
      });
      await this.recomputeStudentAccountStatus(tx, studentId, auth.userId, client);
      return row;
    });
  }

  async revoke(auth: AuthContext, studentId: string, consentId: string, client: ClientInfo) {
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const row = await tx.parentalConsent.findFirst({
        where: { id: consentId, studentId },
        select: { id: true, guardianId: true, userId: true, revokedAt: true, purpose: true, schoolId: true, channel: true },
      });
      if (!row || row.revokedAt) throw new NotFoundException();
      if (auth.role === "parent") {
        const link = await this.requireLinkedGuardian(tx, auth, studentId);
        if (row.guardianId !== link.guardianId) throw new ForbiddenException();
      } else if (auth.role !== "direction" && auth.role !== "super_admin") {
        throw new ForbiddenException();
      }
      await tx.parentalConsent.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), revokedById: auth.userId },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.userId,
          schoolId: row.schoolId,
          action: "consent.revoke",
          entity: "ParentalConsent",
          entityId: row.id,
          severity: "warning",
          metadata: { purpose: row.purpose, channel: row.channel, studentId },
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
        },
      });
      await this.recomputeStudentAccountStatus(tx, studentId, auth.userId, client);
      return { ok: true };
    });
  }

  /**
   * Recalcule Student.accountStatus. Parametre CONSENT_REQUIRE_ALL_LINKED_GUARDIANS :
   * - false (defaut) : un consentement actif (web/mobile/papier) suffit ;
   * - true : chaque responsable LIE (Guardian.userId non null) doit avoir un consentement actif.
   * Question au juriste : ce parametre doit rester facile a inverser.
   */
  async recomputeStudentAccountStatus(
    tx: Prisma.TransactionClient,
    studentId: string,
    actorId: string | null,
    client?: ClientInfo,
  ): Promise<"none" | "active" | "suspended_no_consent"> {
    const student = await tx.student.findUnique({
      where: { id: studentId },
      select: { id: true, schoolId: true, accountStatus: true },
    });
    if (!student) return "none";

    const activeConsents = await tx.parentalConsent.findMany({
      where: { studentId, purpose: "student_account", revokedAt: null },
      select: { id: true, guardianId: true, channel: true },
    });
    const linked = await tx.studentGuardian.findMany({
      where: { studentId, guardian: { userId: { not: null } } },
      select: { guardianId: true },
    });

    let ok = false;
    if (consentRequireAllLinkedGuardians()) {
      if (linked.length === 0) {
        // Aucun responsable lie : un accord papier de la direction suffit.
        ok = activeConsents.some((c) => c.channel === "paper_school");
      } else {
        const withConsent = new Set(activeConsents.filter((c) => c.guardianId).map((c) => c.guardianId as string));
        ok = linked.every((l) => withConsent.has(l.guardianId));
      }
    } else {
      ok = activeConsents.length > 0;
    }

    let status: "none" | "active" | "suspended_no_consent";
    if (ok) status = "active";
    else if (student.accountStatus === "none" && activeConsents.length === 0) status = "none";
    else status = "suspended_no_consent";

    if (status !== student.accountStatus) {
      await tx.student.update({ where: { id: studentId }, data: { accountStatus: status }, select: { id: true } });
      if (status === "suspended_no_consent") {
        await this.revokeStudentSessions(tx, studentId);
        await tx.auditLog.create({
          data: {
            actorId,
            schoolId: student.schoolId,
            action: "student.suspend.no_consent",
            entity: "Student",
            entityId: studentId,
            severity: "warning",
            metadata: {
              requireAllLinked: consentRequireAllLinkedGuardians(),
              activeConsents: activeConsents.length,
            },
            ip: client?.ip ?? null,
            userAgent: client?.userAgent ?? null,
          },
        });
      }
    }
    return status;
  }

  private async revokeStudentSessions(tx: Prisma.TransactionClient, studentId: string) {
    // Profils eleve lies : UserProfile.role=student avec displayName match is not reliable.
    // Convention : un compte eleve porte un profil student ; on cherche via invitations/activation
    // futures. Pour l'instant, revoquer les devices des users qui ont un profil student sur la meme ecole
    // n'est pas lie au studentId. On stocke le lien via Guardian pattern - student users not yet shipped.
    // Revoke any Device whose activeProfile is a student profile attached to this school and whose
    // user email equals student activation path - skip if no student user exists.
    void studentId;
    void tx;
  }

  private async requireValidatedText(tx: Prisma.TransactionClient, textId: string, purpose: ConsentPurpose) {
    const text = await tx.consentText.findUnique({
      where: { id: textId },
      select: { id: true, purpose: true, status: true, version: true, locale: true, bodySha256: true },
    });
    if (!text || text.purpose !== purpose) throw new NotFoundException("Texte de consentement introuvable.");
    if (text.status !== "validated") {
      throw new ConflictException("Ce texte est un brouillon : il est refuse pour tout compte reel tant qu'il n'est pas valide.");
    }
    return text;
  }

  private async requireLinkedGuardian(tx: Prisma.TransactionClient, auth: AuthContext, studentId: string) {
    const guardian = await tx.guardian.findFirst({
      where: { userId: auth.userId, schoolId: auth.schoolId! },
      select: { id: true },
    });
    if (!guardian) throw new ForbiddenException();
    const link = await tx.studentGuardian.findFirst({
      where: { studentId, guardianId: guardian.id, schoolId: auth.schoolId! },
      select: { guardianId: true },
    });
    if (!link) throw new ForbiddenException("Ce responsable n'est pas lie a cet eleve.");
    return link;
  }

  private async assertCanViewStudent(tx: Prisma.TransactionClient, auth: AuthContext, studentId: string) {
    if (auth.role === "direction" || auth.role === "super_admin") {
      const s = await tx.student.findFirst({ where: { id: studentId, ...(auth.schoolId ? { schoolId: auth.schoolId } : {}) }, select: { id: true } });
      if (!s) throw new NotFoundException();
      return;
    }
    await this.requireLinkedGuardian(tx, auth, studentId);
  }
}
