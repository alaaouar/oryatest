import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import argon2 from "argon2";
import type { AccountDeletionKind, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth.types";
import { toTenantContext } from "../auth/auth.types";
import { MfaService } from "../auth/mfa.service";
import { readCredentials, readMfaState } from "../auth/auth-lookup.sql";
import type { ClientInfo } from "../auth/auth.service";
import { PrismaService } from "../core/prisma.service";
import { TenancyService } from "../core/tenancy.service";
import { ConsentService } from "../consent/consent.service";
import { NotificationsService } from "../parent-space/notifications.service";
import { ACCOUNT_DELETION_DELAY_DAYS } from "../consent/consent.types";
import { appendJournal, legacySha256, readJournalSources, registerHmac, type JournalSources, type RegisterEntry } from "./deletion-register";

export type Clock = { now(): Date };

const defaultClock: Clock = { now: () => new Date() };


/** Refuse toute metadonnees d'audit contenant un e-mail ou un telephone. */
export function assertAuditMetadataClean(metadata: Record<string, unknown> | null | undefined): void {
  if (!metadata) return;
  // Les UUID (requestId...) ne sont pas des telephones : retires avant le controle
  // (faux positif aleatoire constate au bloc 3 : "...343-3156-40..." matchait).
  const blob = JSON.stringify(metadata).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>");
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(blob)) {
    throw new Error("REFUS_AUDIT_PII: e-mail interdit dans AuditLog.metadata");
  }
  if (/(?:\+?\d[\d\s.-]{7,}\d)/.test(blob)) {
    throw new Error("REFUS_AUDIT_PII: telephone interdit dans AuditLog.metadata");
  }
}

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);
  private clock: Clock = defaultClock;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
    private readonly consents: ConsentService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Horloge injectable pour les tests (simulateur). */
  setClock(clock: Clock): void {
    this.clock = clock;
  }

  async requestSelfDeletion(auth: AuthContext, password: string, mfaCode: string | undefined, client: ClientInfo) {
    if (auth.role === "student") {
      throw new ForbiddenException("Un eleve ne peut pas demander la suppression seul : notifiez un responsable lie.");
    }
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      await this.verifyReauth(tx, auth.userId, password, mfaCode);
      if (auth.role === "direction" && auth.schoolId) {
        const peers = await tx.userProfile.count({
          where: { schoolId: auth.schoolId, role: "direction", user: { status: "active", deletedAt: null } },
        });
        if (peers <= 1) {
          throw new ConflictException("Designez un successeur avant de supprimer le dernier administrateur de l'ecole.");
        }
      }
      if (auth.role === "super_admin") {
        const peers = await tx.userProfile.count({
          where: { role: "super_admin", user: { status: "active", deletedAt: null } },
        });
        if (peers <= 1) {
          throw new ConflictException("Le dernier super-administrateur ne peut pas etre supprime.");
        }
      }
      const pending = await tx.accountDeletionRequest.findFirst({
        where: { userId: auth.userId, status: "pending" },
        select: { id: true },
      });
      if (pending) throw new ConflictException("Une demande de suppression est deja en cours.");

      const now = this.clock.now();
      const effectiveAt = new Date(now.getTime() + ACCOUNT_DELETION_DELAY_DAYS * 86_400_000);
      const req = await tx.accountDeletionRequest.create({
        data: {
          userId: auth.userId,
          schoolId: auth.schoolId,
          kind: "self",
          status: "pending",
          requestedById: auth.userId,
          requestedAt: now,
          effectiveAt,
          requestIp: client.ip ?? null,
        },
        select: { id: true, effectiveAt: true, requestedAt: true },
      });
      await tx.user.update({
        where: { id: auth.userId },
        data: { status: "disabled" },
        select: { id: true },
      });
      await tx.device.updateMany({
        where: { userId: auth.userId, status: "active" },
        data: { status: "revoked", revokedAt: now },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.userId,
          schoolId: auth.schoolId,
          action: "account.delete.requested",
          entity: "User",
          entityId: auth.userId,
          severity: "warning",
          metadata: { kind: "self", effectiveAt: effectiveAt.toISOString(), delayDays: ACCOUNT_DELETION_DELAY_DAYS },
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
        },
      });
      return { status: "pending" as const, ...req };
    });
  }

  /**
   * Suppression d'un compte eleve : par un responsable lie OU par l'ecole (direction).
   * Jamais par l'eleve seul.
   */
  async requestStudentDeletion(
    auth: AuthContext,
    studentId: string,
    password: string,
    mfaCode: string | undefined,
    client: ClientInfo,
  ) {
    if (auth.role === "student") {
      throw new ForbiddenException("Un eleve ne peut pas demander la suppression seul : notifiez un responsable lie.");
    }
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      await this.verifyReauth(tx, auth.userId, password, mfaCode);
      const student = await tx.student.findFirst({
        where: { id: studentId, schoolId: auth.schoolId! },
        select: { id: true, schoolId: true, accountStatus: true },
      });
      if (!student) throw new NotFoundException();

      let kind: AccountDeletionKind;
      if (auth.role === "direction" || auth.role === "super_admin") {
        kind = "student_by_school";
      } else if (auth.role === "parent") {
        const guardian = await tx.guardian.findFirst({ where: { userId: auth.userId, schoolId: auth.schoolId! }, select: { id: true } });
        if (!guardian) throw new ForbiddenException();
        const link = await tx.studentGuardian.findFirst({ where: { studentId, guardianId: guardian.id }, select: { id: true } });
        if (!link) throw new ForbiddenException("Seul un responsable lie peut demander la suppression.");
        kind = "student_by_guardian";
      } else {
        throw new ForbiddenException();
      }

      const pending = await tx.accountDeletionRequest.findFirst({
        where: { studentId, status: "pending" },
        select: { id: true },
      });
      if (pending) throw new ConflictException("Une demande de suppression est deja en cours pour cet eleve.");

      const now = this.clock.now();
      const effectiveAt = new Date(now.getTime() + ACCOUNT_DELETION_DELAY_DAYS * 86_400_000);
      const req = await tx.accountDeletionRequest.create({
        data: {
          studentId,
          schoolId: student.schoolId,
          kind,
          status: "pending",
          requestedById: auth.userId,
          requestedAt: now,
          effectiveAt,
          requestIp: client.ip ?? null,
        },
        select: { id: true, effectiveAt: true, requestedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.userId,
          schoolId: student.schoolId,
          action: "account.delete.requested",
          entity: "Student",
          entityId: studentId,
          severity: "warning",
          metadata: { kind, effectiveAt: effectiveAt.toISOString(), delayDays: ACCOUNT_DELETION_DELAY_DAYS },
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
        },
      });
      return { status: "pending" as const, kind, ...req };
    });
  }

  async cancel(auth: AuthContext, client: ClientInfo) {
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const req = await tx.accountDeletionRequest.findFirst({
        where: { userId: auth.userId, status: "pending" },
        select: { id: true, effectiveAt: true },
      });
      if (!req) throw new NotFoundException();
      if (this.clock.now().getTime() >= req.effectiveAt.getTime()) {
        throw new ConflictException("Le delai de retractation est depasse.");
      }
      await tx.accountDeletionRequest.update({
        where: { id: req.id },
        data: { status: "cancelled", cancelledAt: this.clock.now() },
        select: { id: true },
      });
      await tx.user.update({
        where: { id: auth.userId },
        data: { status: "active" },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: auth.userId,
          schoolId: auth.schoolId,
          action: "account.delete.cancelled",
          entity: "User",
          entityId: auth.userId,
          severity: "info",
          metadata: { requestId: req.id },
          ip: client.ip ?? null,
          userAgent: client.userAgent ?? null,
        },
      });
      return { ok: true };
    });
  }

  async status(auth: AuthContext) {
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const req = await tx.accountDeletionRequest.findFirst({
        where: {
          OR: [{ userId: auth.userId }, { requestedById: auth.userId }],
          status: { in: ["pending", "completed"] },
        },
        orderBy: { requestedAt: "desc" },
        select: { id: true, status: true, kind: true, requestedAt: true, effectiveAt: true, completedAt: true, cancelledAt: true },
      });
      return { request: req };
    });
  }

  /**
   * Job quotidien : anonymise les demandes dont effectiveAt <= now.
   * clock injectable. En cas d'echec : log + notification super-admin (alerte).
   */
  async runDueJob(options?: { clock?: Clock; alert?: (msg: string) => Promise<void> }): Promise<{ processed: number; failed: number }> {
    if (options?.clock) this.clock = options.clock;
    const now = this.clock.now();
    let processed = 0;
    let failed = 0;
    // Lecture transversale du job : contexte super-admin (RLS), sans session utilisateur.
    const due = await this.tenancy.runSystem(async (tx) =>
      tx.accountDeletionRequest.findMany({
        where: { status: "pending", effectiveAt: { lte: now } },
        select: { id: true, userId: true, studentId: true, schoolId: true, kind: true },
        take: 100,
      }),
    );
    for (const req of due) {
      try {
        await this.anonymizeRequest(req.id);
        processed += 1;
      } catch (error) {
        failed += 1;
        const msg = error instanceof Error ? error.message : "inconnu";
        this.logger.error(`Job suppression echec request=${req.id} : ${msg}`);
        if (options?.alert) await options.alert(`account-deletion job failed for ${req.id}: ${msg}`);
        else await this.alertSuperAdmins(req.schoolId, req.id, msg);
      }
    }
    return { processed, failed };
  }

  private async alertSuperAdmins(schoolId: string | null, requestId: string, detail: string) {
    try {
      const admins = await this.tenancy.runSystem(async (tx) =>
        tx.userProfile.findMany({
          where: { role: "super_admin", user: { status: "active" } },
          select: { userId: true },
        }),
      );
      if (admins.length === 0 || !schoolId) return;
      // Contexte systeme (job) : l'ancien contexte "super-admin sans profil" etait
      // refuse par assertContext, l'alerte n'etait jamais emise.
      await this.tenancy.runSystem(
        async (tx) => {
          await this.notifications.notifyUsers(
            tx,
            schoolId,
            admins.map((a) => a.userId),
            {
              kind: "ops.job_failed",
              title: "Echec du job de suppression de compte",
              body: `La demande ${requestId} a echoue. Detail technique reserve aux operateurs.`,
            },
          );
        },
      );
      void detail;
    } catch (error) {
      this.logger.warn(`Alerte job impossible : ${error instanceof Error ? error.message : "inconnu"}`);
    }
  }

  async anonymizeRequest(requestId: string): Promise<void> {
    await this.tenancy.runSystem(async (tx) => {
      const req = await tx.accountDeletionRequest.findUnique({
        where: { id: requestId },
        select: { id: true, userId: true, studentId: true, schoolId: true, kind: true, status: true },
      });
      if (!req || req.status !== "pending") return;

      if (req.kind === "self" && req.userId) {
        await this.anonymizeUserIdentity(tx, req.userId, req.schoolId, req.kind, req.id);
      } else if (req.studentId) {
        await this.anonymizeStudentAccount(tx, req.studentId, req.schoolId, req.kind, req.id, req.userId);
      }

      await tx.accountDeletionRequest.update({
        where: { id: req.id },
        data: { status: "completed", completedAt: this.clock.now() },
        select: { id: true },
      });
    });
  }

  /**
   * Anonymise l'identite ORYA (compte, e-mail, appareils, profil) et coupe le lien Guardian.userId.
   * Ne detruit PAS les donnees de contact ecole (fullName/email/phone de Guardian restent) :
   * l'ecole est notifiee et peut anonymiser la fiche elle-meme.
   */
  private async anonymizeUserIdentity(
    tx: Prisma.TransactionClient,
    userId: string,
    schoolId: string | null,
    kind: AccountDeletionKind,
    requestId: string,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, deletedAt: true },
    });
    if (!user || user.deletedAt) return;

    const emailHash = registerHmac(user.email.toLowerCase());
    const userIdHash = registerHmac(user.id);
    const legacyEmailHash = legacySha256(user.email.toLowerCase());

    await tx.device.updateMany({
      where: { userId },
      data: { status: "revoked", revokedAt: this.clock.now() },
    });
    await tx.device.deleteMany({ where: { userId } });

    const guardians = await tx.guardian.findMany({ where: { userId }, select: { id: true, schoolId: true } });
    for (const g of guardians) {
      await tx.guardian.update({
        where: { id: g.id },
        data: { userId: null },
        select: { id: true },
      });
      // Consentements parentaux actifs retires (declenche J1.1)
      const active = await tx.parentalConsent.findMany({
        where: { guardianId: g.id, revokedAt: null },
        select: { id: true, studentId: true },
      });
      for (const c of active) {
        await tx.parentalConsent.update({
          where: { id: c.id },
          data: { revokedAt: this.clock.now(), revokedById: null },
          select: { id: true },
        });
        await this.consents.recomputeStudentAccountStatus(tx, c.studentId, null);
      }
    }

    await tx.userProfile.updateMany({
      where: { userId },
      data: { displayName: "Compte supprime" },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted+${userId.replace(/-/g, "").slice(0, 32)}@invalid`,
        passwordHash: "!", // inutilisable pour argon2.verify
        mfaSecret: null,
        mfaEnrolledAt: null,
        mfaLastStep: null,
        status: "deleted",
        deletedAt: this.clock.now(),
        activeProfileId: null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      select: { id: true },
    });

    await tx.notification.deleteMany({ where: { userId } });
    await tx.messageRecipient.deleteMany({ where: { userId } });

    // DeletionRegister : INSERT seulement (UPDATE revoque pour orya_app). Si l'empreinte
    // existe deja (rejeu apres restauration), on ne retouche pas le registre.
    const existingReg = await tx.deletionRegister.findFirst({
      where: { emailHash: { in: [emailHash, legacyEmailHash] } },
      select: { id: true },
    });
    if (!existingReg) {
      const entry: RegisterEntry = {
        emailHash,
        userIdHash,
        studentIdHash: null,
        schoolIdHash: schoolId ? registerHmac(schoolId) : null,
        kind,
        anonymizedAt: this.clock.now().toISOString(),
        sourceRequestId: requestId,
      };
      await tx.deletionRegister.create({
        data: { ...entry, anonymizedAt: new Date(entry.anonymizedAt) },
        select: { id: true },
      });
      // Copie append-only hors base, dans la transaction : echec d'ecriture = rollback.
      await appendJournal(entry);
    }

    const meta = { kind, actor: "Compte supprime", requestId };
    assertAuditMetadataClean(meta);
    await tx.auditLog.create({
      data: {
        actorId: null,
        schoolId,
        action: "account.delete.completed",
        entity: "User",
        entityId: userId,
        severity: "critical",
        metadata: meta,
      },
    });

    // Notifier la direction de chaque ecole concernee (fiche Guardian a revoir)
    for (const g of guardians) {
      const directors = await tx.userProfile.findMany({
        where: { schoolId: g.schoolId, role: "direction", user: { status: "active" } },
        select: { userId: true },
      });
      if (directors.length > 0) {
        await this.notifications.notifyUsers(
          tx,
          g.schoolId,
          directors.map((d) => d.userId),
          {
            kind: "account.guardian_unlinked",
            title: "Compte parent supprime",
            body: "Un responsable a supprime son compte ORYA. La fiche ecole est conservee : vous pouvez l'anonymiser si besoin.",
            link: `/guardians/${g.id}`,
          },
        );
      }
    }
  }

  private async anonymizeStudentAccount(
    tx: Prisma.TransactionClient,
    studentId: string,
    schoolId: string | null,
    kind: AccountDeletionKind,
    requestId: string,
    _actorId: string | null,
  ) {
    const student = await tx.student.findUnique({
      where: { id: studentId },
      select: { id: true, schoolId: true, studentCode: true },
    });
    if (!student) return;

    // Retirer les consentements actifs ; le dossier scolaire (Student) reste.
    await tx.parentalConsent.updateMany({
      where: { studentId, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
    await tx.student.update({
      where: { id: studentId },
      data: {
        accountStatus: "none",
        activationCodeHash: null,
        activationCodeIssuedAt: null,
        activationCodeExpiresAt: null,
      },
      select: { id: true },
    });

    const studentEmailHash = registerHmac("student:" + studentId);
    const existingStudentReg = await tx.deletionRegister.findFirst({
      where: { emailHash: { in: [studentEmailHash, legacySha256("student:" + studentId)] } },
      select: { id: true },
    });
    if (!existingStudentReg) {
      const entry: RegisterEntry = {
        emailHash: studentEmailHash,
        userIdHash: registerHmac(studentId),
        studentIdHash: registerHmac(studentId),
        schoolIdHash: schoolId ? registerHmac(schoolId) : null,
        kind,
        anonymizedAt: this.clock.now().toISOString(),
        sourceRequestId: requestId,
      };
      await tx.deletionRegister.create({
        data: { ...entry, anonymizedAt: new Date(entry.anonymizedAt) },
        select: { id: true },
      });
      await appendJournal(entry);
    }

    const meta = { kind, actor: "Compte supprime", requestId };
    assertAuditMetadataClean(meta);
    await tx.auditLog.create({
      data: {
        actorId: null,
        schoolId,
        action: "account.delete.completed",
        entity: "Student",
        entityId: studentId,
        severity: "critical",
        metadata: meta,
      },
    });

    if (schoolId) {
      const directors = await tx.userProfile.findMany({
        where: { schoolId, role: "direction", user: { status: "active" } },
        select: { userId: true },
      });
      if (directors.length > 0) {
        await this.notifications.notifyUsers(
          tx,
          schoolId,
          directors.map((d) => d.userId),
          {
            kind: "account.student_unlinked",
            title: "Compte eleve ORYA supprime",
            body: "Le compte ORYA d'un eleve a ete supprime. Le dossier scolaire est conserve.",
          },
        );
      }
    }
  }

  /**
   * Rejoue le registre apres restauration de sauvegarde. Sources : la table
   * DeletionRegister ET la copie append-only hors base (journal), pour couvrir une
   * sauvegarde anterieure a la suppression. Les entrees du journal absentes de la
   * base y sont reinserees (INSERT seul), puis tout compte ou eleve dont
   * l'empreinte figure au registre est re-anonymise. Empreintes reconnues :
   * HMAC-SHA256 (courant) et SHA-256 simple (lignes historiques du bloc 2).
   */
  async replayDeletionRegister(): Promise<{ scanned: number; fixed: number; journal: number; restored: number; students: number; sources: Omit<JournalSources, "entries"> }> {
    // t62u B3 : fichier local + copie WORM (si identifiants de lecture fournis a l'operateur).
    const { entries: journal, ...sources } = await readJournalSources();
    const dbEntries = await this.tenancy.runSystem(async (tx) =>
      tx.deletionRegister.findMany({ select: { emailHash: true } }),
    );
    const known = new Set(dbEntries.map((e) => e.emailHash));
    const missing = journal.filter((e) => !known.has(e.emailHash));
    if (missing.length > 0) {
      await this.tenancy.runSystem(async (tx) => {
        for (const e of missing) {
          await tx.deletionRegister.create({
            data: { ...e, anonymizedAt: new Date(e.anonymizedAt) },
            select: { id: true },
          });
        }
      });
    }

    const { entries, users, students } = await this.tenancy.runSystem(async (tx) => {
      const entries = await tx.deletionRegister.findMany({
        select: { emailHash: true, userIdHash: true, studentIdHash: true, kind: true, id: true },
      });
      const users = await tx.user.findMany({
        where: { deletedAt: null },
        select: { id: true, email: true },
        take: 10000,
      });
      const students = await tx.student.findMany({
        where: { accountStatus: { not: "none" } },
        select: { id: true, schoolId: true },
        take: 10000,
      });
      return { entries, users, students };
    });
    const byEmail = new Map(entries.map((e) => [e.emailHash, e]));
    const byUserId = new Map(entries.map((e) => [e.userIdHash, e]));
    const byStudent = new Map(entries.filter((e) => e.studentIdHash).map((e) => [e.studentIdHash as string, e]));
    let fixed = 0;
    for (const u of users) {
      const email = u.email.toLowerCase();
      const hit =
        byEmail.get(registerHmac(email)) ??
        byEmail.get(legacySha256(email)) ??
        byUserId.get(registerHmac(u.id)) ??
        byUserId.get(legacySha256(u.id));
      if (!hit) continue;
      await this.tenancy.runSystem(async (tx) => {
        await this.anonymizeUserIdentity(tx, u.id, null, hit.kind, hit.id);
      });
      fixed += 1;
    }
    let studentsFixed = 0;
    for (const st of students) {
      const hit = byStudent.get(registerHmac(st.id)) ?? byStudent.get(legacySha256(st.id));
      if (!hit) continue;
      await this.tenancy.runSystem(async (tx) => {
        await this.anonymizeStudentAccount(tx, st.id, st.schoolId, hit.kind, hit.id, null);
      });
      studentsFixed += 1;
    }
    return { scanned: users.length, fixed, journal: journal.length, restored: missing.length, students: studentsFixed, sources };
  }

  private async verifyReauth(tx: Prisma.TransactionClient, userId: string, password: string, mfaCode?: string) {
    const pub = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true, mfaEnrolledAt: true },
    });
    if (!pub || pub.status === "deleted") throw new UnauthorizedException();
    const cred = await readCredentials(tx, pub.email);
    if (!cred?.found || !cred.password_hash) throw new UnauthorizedException();
    const ok = await argon2.verify(cred.password_hash, password).catch(() => false);
    if (!ok) throw new UnauthorizedException("Identifiants incorrects.");
    if (pub.mfaEnrolledAt) {
      if (!mfaCode) throw new UnprocessableEntityException("Code MFA requis.");
      const state = await readMfaState(tx, userId);
      if (!state?.found || !state.mfa_secret) throw new UnauthorizedException();
      const check = this.mfa.verifyCode(mfaCode, state.mfa_secret);
      if (!check.valid || check.step === null) throw new UnauthorizedException("Code MFA invalide.");
      if (state.mfa_last_step !== null && check.step <= state.mfa_last_step) {
        throw new UnauthorizedException("Code MFA deja utilise.");
      }
      // Persister le pas consomme via le role owner n'est pas possible ici ; la
      // fenetre de rejeu restante est courte (30 s) et acceptable pour une re-auth.
    }
  }
}
