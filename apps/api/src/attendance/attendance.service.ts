import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { AttendanceStatus, Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type { AuthContext } from "../auth/auth.types";
import { absenceActionsToCreate, effectiveClientTime, frenchDay, slotLabel, studentNoticeTitle, syncDecision, type SyncResult } from "./attendance-rules";
import { toTenantContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { parseCivilDate, schoolYearForDate } from "../core/school-year";
import { schoolDayIn } from "../calendar/calendar.query";
import { TenancyService } from "../core/tenancy.service";
import { NotificationsService } from "../parent-space/notifications.service";
import type {
  AttendanceMarkDto,
  BulkAttendanceDto,
  OpenSessionDto,
  ReopenSessionDto,
  SyncAttendanceDto,
} from "./attendance.dto";

/**
 * Sessions d'appel et lignes de présence (Lot 2.2).
 *
 * Règles :
 *  - schoolId uniquement depuis le jeton ;
 *  - enseignant : affectation obligatoire à la classe / année ;
 *  - direction : accès à toutes les classes de l'école ;
 *  - session close → écriture refusée (409) sauf réouverture (direction).
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async open(auth: AuthContext, dto: OpenSessionDto, client: ClientInfo) {
    const context = toTenantContext(auth);
    const schoolId = requireSchool(auth);
    const date = safeParseDate(dto.date);
    const schoolYear = schoolYearForDate(date);

    const session = await this.tenancy.run(context, async (tx) => {
      await this.assertCanAccessClassroom(tx, auth, dto.classroomId, schoolYear);

      // t92 (CDC M2) : pas d'appel un jour de vacances, ni un jour non ouvre d'un calendrier configure.
      const day = await schoolDayIn(tx, schoolId, date);
      if (day.reason === "holiday") {
        throw new ConflictException(`Jour de vacances (${day.holiday?.label ?? "calendrier"}) : pas d'appel ce jour-là.`);
      }
      if (day.reason === "non_working_day" && day.configured) {
        throw new ConflictException("Jour non ouvré selon le calendrier de l'établissement : pas d'appel ce jour-là.");
      }

      const existing = await tx.attendanceSession.findFirst({
        where: {
          schoolId,
          classroomId: dto.classroomId,
          date,
          slot: dto.slot,
        },
        select: { id: true, status: true },
      });
      if (existing) {
        throw new ConflictException("Une session existe déjà pour cette classe, date et demi-journée.");
      }

      const enrollmentCount = await tx.enrollment.count({
        where: { classroomId: dto.classroomId, schoolYear },
      });

      const created = await tx.attendanceSession.create({
        data: {
          schoolId,
          classroomId: dto.classroomId,
          date,
          slot: dto.slot,
          schoolYear,
          openedById: auth.userId,
        },
        select: {
          id: true,
          classroomId: true,
          date: true,
          slot: true,
          status: true,
          schoolYear: true,
          version: true,
          createdAt: true,
        },
      });

      return { ...created, enrollmentCount };
    });

    await this.audit.scoped(context, {
      action: "attendance.session.opened",
      entity: "AttendanceSession",
      entityId: session.id,
      metadata: {
        classroomId: session.classroomId,
        date: dto.date,
        slot: dto.slot,
        enrollmentCount: session.enrollmentCount,
      },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return session;
  }

  async get(auth: AuthContext, sessionId: string) {
    const context = toTenantContext(auth);
    requireSchool(auth);

    const session = await this.tenancy.run(context, async (tx) => {
      const found = await tx.attendanceSession.findFirst({
        where: { id: sessionId },
        select: {
          id: true,
          classroomId: true,
          date: true,
          slot: true,
          status: true,
          schoolYear: true,
          version: true,
          closedAt: true,
          reopenedAt: true,
          reopenReason: true,
          createdAt: true,
          classroom: { select: { id: true, name: true } },
          rows: {
            orderBy: { recordedAt: "asc" },
            select: {
              id: true,
              studentId: true,
              status: true,
              recordedAt: true,
              version: true,
              student: { select: { studentCode: true, displayName: true } },
            },
          },
        },
      });
      if (!found) {
        throw new NotFoundException("Session d'appel introuvable.");
      }
      await this.assertCanAccessClassroom(tx, auth, found.classroomId, found.schoolYear);
      return found;
    });

    return session;
  }

  async roster(auth: AuthContext, classroomId: string, dateRaw: string) {
    const context = toTenantContext(auth);
    requireSchool(auth);
    const date = safeParseDate(dateRaw);
    const schoolYear = schoolYearForDate(date);

    return this.tenancy.run(context, async (tx) => {
      await this.assertCanAccessClassroom(tx, auth, classroomId, schoolYear);

      const students = await tx.enrollment.findMany({
        where: { classroomId, schoolYear },
        orderBy: { student: { studentCode: "asc" } },
        select: {
          student: {
            select: { id: true, studentCode: true, displayName: true },
          },
        },
      });

      return {
        classroomId,
        date: dateRaw,
        schoolYear,
        students: students.map((entry) => entry.student),
      };
    });
  }

  async markOne(auth: AuthContext, sessionId: string, dto: AttendanceMarkDto, client: ClientInfo) {
    return this.markMany(auth, sessionId, { rows: [dto] }, client);
  }

  async markMany(
    auth: AuthContext,
    sessionId: string,
    dto: BulkAttendanceDto,
    client: ClientInfo,
  ) {
    const context = toTenantContext(auth);
    const schoolId = requireSchool(auth);

    const result = await this.tenancy.run(context, async (tx) => {
      const session = await tx.attendanceSession.findFirst({
        where: { id: sessionId },
        select: { id: true, status: true, classroomId: true, schoolYear: true },
      });
      if (!session) {
        throw new NotFoundException("Session d'appel introuvable.");
      }
      if (session.status === "closed") {
        throw new ConflictException("Session clôturée : modification interdite (réouverture requise).");
      }

      await this.assertCanAccessClassroom(tx, auth, session.classroomId, session.schoolYear);

      const studentIds = [...new Set(dto.rows.map((row) => row.studentId))];
      const enrolled = await tx.enrollment.findMany({
        where: {
          classroomId: session.classroomId,
          schoolYear: session.schoolYear,
          studentId: { in: studentIds },
        },
        select: { studentId: true },
      });
      const enrolledSet = new Set(enrolled.map((entry) => entry.studentId));

      // Lot 2.3 : état antérieur pour tracer chaque changement (historique).
      const previousRows = await tx.attendanceRow.findMany({
        where: { sessionId: session.id, studentId: { in: studentIds } },
        select: { studentId: true, status: true },
      });
      const previous = new Map(previousRows.map((entry) => [entry.studentId, entry.status]));
      const changes: { studentId: string; from: AttendanceStatus | null; to: AttendanceStatus }[] = [];

      const rejected: { studentId: string; message: string }[] = [];
      const accepted: { studentId: string; status: AttendanceStatus }[] = [];

      for (const row of dto.rows) {
        if (!enrolledSet.has(row.studentId)) {
          rejected.push({
            studentId: row.studentId,
            message: "élève non inscrit dans cette classe pour l'année scolaire",
          });
          continue;
        }
        accepted.push({ studentId: row.studentId, status: row.status });
        const before = previous.get(row.studentId) ?? null;
        if (before !== row.status) {
          changes.push({ studentId: row.studentId, from: before, to: row.status });
          previous.set(row.studentId, row.status);
        }
      }

      for (const row of dto.rows) {
        if (!enrolledSet.has(row.studentId)) {
          continue;
        }

        const data: Prisma.AttendanceRowUpsertArgs["create"] = {
          schoolId,
          sessionId: session.id,
          studentId: row.studentId,
          status: row.status,
          recordedById: auth.userId,
          recordedAt: new Date(),
          clientMutationId: row.clientMutationId ?? null,
        };

        await tx.attendanceRow.upsert({
          where: {
            sessionId_studentId: { sessionId: session.id, studentId: row.studentId },
          },
          create: data,
          update: {
            status: row.status,
            recordedById: auth.userId,
            recordedAt: new Date(),
            version: { increment: 1 },
            ...(row.clientMutationId ? { clientMutationId: row.clientMutationId } : {}),
          },
        });
      }

      await tx.attendanceSession.update({
        where: { id: session.id },
        data: { version: { increment: 1 } },
      });

      return { accepted: accepted.length, rejected, changes };
    });

    await this.audit.scoped(context, {
      action: "attendance.rows.recorded",
      entity: "AttendanceSession",
      entityId: sessionId,
      metadata: {
        accepted: result.accepted,
        rejected: result.rejected.length,
        changes: result.changes.slice(0, 200),
      },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return { accepted: result.accepted, rejected: result.rejected, changed: result.changes.length };
  }

  /**
   * F03 / B11 (ADR-003) : rejeu de la file hors ligne d'une session. Idempotent par
   * clientMutationId ; session cloturee : le serveur gagne (resultat "closed", rien n'est
   * ecrit, pas de 409 pour que l'appareil purge sa file) ; session ouverte : dernier ecrit
   * gagne sur l'heure de saisie (bornee a l'heure serveur). Mutations traitees par heure
   * croissante. Resultat par mutation : applied | duplicate | stale | closed | rejected.
   */
  async sync(auth: AuthContext, sessionId: string, dto: SyncAttendanceDto, client: ClientInfo) {
    const context = toTenantContext(auth);
    const schoolId = requireSchool(auth);
    const now = new Date();
    type Out = { clientMutationId: string; studentId: string; result: SyncResult; status: AttendanceStatus | null; message?: string };

    let result: { sessionStatus: string; version: number; results: Out[]; changes: { studentId: string; from: AttendanceStatus | null; to: AttendanceStatus }[] };
    try {
      result = await this.tenancy.run(context, async (tx) => {
        const session = await tx.attendanceSession.findFirst({
          where: { id: sessionId },
          select: { id: true, status: true, classroomId: true, schoolYear: true, version: true },
        });
        if (!session) {
          throw new NotFoundException("Session d'appel introuvable.");
        }
        await this.assertCanAccessClassroom(tx, auth, session.classroomId, session.schoolYear);

        const studentIds = [...new Set(dto.mutations.map((m) => m.studentId))];
        const rows = await tx.attendanceRow.findMany({
          where: { sessionId: session.id, studentId: { in: studentIds } },
          select: { studentId: true, status: true, recordedAt: true },
        });
        const current = new Map(rows.map((r) => [r.studentId, { status: r.status as AttendanceStatus, recordedAt: r.recordedAt }]));
        const closed = session.status === "closed";
        const results: Out[] = new Array(dto.mutations.length);
        const changes: { studentId: string; from: AttendanceStatus | null; to: AttendanceStatus }[] = [];

        if (closed) {
          dto.mutations.forEach((m, i) => {
            results[i] = { clientMutationId: m.clientMutationId, studentId: m.studentId, result: "closed", status: current.get(m.studentId)?.status ?? null };
          });
          return { sessionStatus: "closed", version: session.version, results, changes };
        }

        const enrolled = await tx.enrollment.findMany({
          where: { classroomId: session.classroomId, schoolYear: session.schoolYear, studentId: { in: studentIds } },
          select: { studentId: true },
        });
        const enrolledSet = new Set(enrolled.map((e) => e.studentId));
        const knownRows = await tx.attendanceRow.findMany({
          where: { clientMutationId: { in: dto.mutations.map((m) => m.clientMutationId) } },
          select: { clientMutationId: true, sessionId: true, studentId: true },
        });
        const known = new Map(knownRows.map((k) => [k.clientMutationId as string, { sessionId: k.sessionId, studentId: k.studentId }]));

        const ordered = dto.mutations
          .map((m, i) => ({ m, i, at: effectiveClientTime(m.recordedAt, now) }))
          .sort((a, b) => a.at.getTime() - b.at.getTime() || a.i - b.i);
        let applied = 0;
        for (const { m, i, at } of ordered) {
          const base = { clientMutationId: m.clientMutationId, studentId: m.studentId };
          if (!enrolledSet.has(m.studentId)) {
            results[i] = { ...base, result: "rejected", status: null, message: "eleve non inscrit dans cette classe pour l'annee scolaire" };
            continue;
          }
          const k = known.get(m.clientMutationId);
          const decision = syncDecision({
            sessionClosed: false,
            known: k ? { sameRow: k.sessionId === session.id && k.studentId === m.studentId } : null,
            current: current.get(m.studentId) ?? null,
            clientAt: at,
          });
          if (decision !== "applied") {
            results[i] = {
              ...base,
              result: decision,
              status: current.get(m.studentId)?.status ?? null,
              ...(decision === "rejected" ? { message: "identifiant de mutation deja utilise" } : {}),
            };
            continue;
          }
          const before = current.get(m.studentId)?.status ?? null;
          await tx.attendanceRow.upsert({
            where: { sessionId_studentId: { sessionId: session.id, studentId: m.studentId } },
            create: {
              schoolId,
              sessionId: session.id,
              studentId: m.studentId,
              status: m.status,
              recordedById: auth.userId,
              recordedAt: at,
              clientMutationId: m.clientMutationId,
            },
            update: {
              status: m.status,
              recordedById: auth.userId,
              recordedAt: at,
              version: { increment: 1 },
              clientMutationId: m.clientMutationId,
            },
          });
          if (before !== m.status) changes.push({ studentId: m.studentId, from: before, to: m.status });
          current.set(m.studentId, { status: m.status, recordedAt: at });
          known.set(m.clientMutationId, { sessionId: session.id, studentId: m.studentId });
          results[i] = { ...base, result: "applied", status: m.status };
          applied += 1;
        }
        let version = session.version;
        if (applied > 0) {
          const updated = await tx.attendanceSession.update({
            where: { id: session.id },
            data: { version: { increment: 1 } },
            select: { version: true },
          });
          version = updated.version;
        }
        return { sessionStatus: "open", version, results, changes };
      });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "P2002") {
        throw new ConflictException("Identifiant de mutation deja utilise : regenerer l'identifiant cote appareil.");
      }
      throw error;
    }

    const count = (r: SyncResult) => result.results.filter((x) => x.result === r).length;
    await this.audit.scoped(context, {
      action: "attendance.rows.synced",
      entity: "AttendanceSession",
      entityId: sessionId,
      metadata: {
        applied: count("applied"),
        duplicate: count("duplicate"),
        stale: count("stale"),
        closed: count("closed"),
        rejected: count("rejected"),
        changes: result.changes.slice(0, 200),
      },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return { sessionStatus: result.sessionStatus, version: result.version, results: result.results };
  }
  async close(auth: AuthContext, sessionId: string, client: ClientInfo) {
    const context = toTenantContext(auth);
    requireSchool(auth);
    let notified = 0;
    let actionsCreated = 0;
    let studentsNotified = 0;

    await this.tenancy.run(context, async (tx) => {
      const session = await tx.attendanceSession.findFirst({
        where: { id: sessionId },
        select: { id: true, status: true, classroomId: true, schoolYear: true },
      });
      if (!session) {
        throw new NotFoundException("Session d'appel introuvable.");
      }
      if (session.status === "closed") {
        throw new ConflictException("Session déjà clôturée.");
      }

      await this.assertCanAccessClassroom(tx, auth, session.classroomId, session.schoolYear);

      await tx.attendanceSession.update({
        where: { id: session.id },
        data: {
          status: "closed",
          closedAt: new Date(),
          closedById: auth.userId,
          version: { increment: 1 },
        },
      });

      notified = await this.notifyFamilies(tx, auth.schoolId!, session.id);
      actionsCreated = await this.createAbsenceActions(tx, auth.schoolId!, session.id, auth.userId);
      studentsNotified = await this.notifyStudents(tx, auth.schoolId!, session.id);
    });

    await this.audit.scoped(context, {
      action: "attendance.session.closed",
      entity: "AttendanceSession",
      entityId: sessionId,
      severity: "warning",
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return { ok: true, status: "closed", familiesNotified: notified, actionsCreated, studentsNotified };
  }

  /**
   * Lot 5 : à la clôture, notification in-app aux parents des élèves absents
   * ou en retard. Une réouverture puis une nouvelle clôture ne renvoie pas de
   * doublon (lien unique par séance et élève).
   */
  private async notifyFamilies(tx: Prisma.TransactionClient, schoolId: string, sessionId: string): Promise<number> {
    const rows = await tx.attendanceRow.findMany({
      where: { sessionId, status: { in: ["absent", "late"] } },
      select: {
        status: true,
        studentId: true,
        session: { select: { date: true, slot: true } },
        student: {
          select: {
            displayName: true,
            guardians: { where: { guardian: { userId: { not: null } } }, select: { guardian: { select: { userId: true } } } },
          },
        },
      },
    });
    let count = 0;
    for (const row of rows) {
      const userIds = row.student.guardians.map((link) => link.guardian.userId).filter((id): id is string => !!id);
      if (userIds.length === 0) continue;
      const link = `/family?seance=${sessionId}&eleve=${row.studentId}`;
      const already = await tx.notification.findMany({ where: { link, userId: { in: userIds } }, select: { userId: true } });
      const done = new Set(already.map((entry) => entry.userId));
      const targets = userIds.filter((id) => !done.has(id));
      if (targets.length === 0) continue;
      const day = frenchDay(row.session.date);
      const slot = slotLabel(row.session.slot);
      count += await this.notifications.notifyUsers(tx, schoolId, targets, {
        kind: row.status === "absent" ? "attendance.absent" : "attendance.late",
        title: `${row.student.displayName} : ${row.status === "absent" ? "absence" : "retard"} le ${day} (${slot})`,
        body: "Vous pouvez envoyer un justificatif depuis votre espace.",
        link,
      });
    }
    return count;
  }

  /**
   * t92 (CDC M3) : information de l'eleve a la cloture. Seuls les eleves dont le compte
   * est actif (consentement parental valide) et qui ont un profil eleve sont informes,
   * une seule fois par seance (lien unique, meme apres reouverture puis nouvelle cloture).
   */
  private async notifyStudents(tx: Prisma.TransactionClient, schoolId: string, sessionId: string): Promise<number> {
    const rows = await tx.attendanceRow.findMany({
      where: { sessionId, status: { in: ["absent", "late"] }, student: { accountStatus: "active" } },
      select: { status: true, studentId: true, session: { select: { date: true, slot: true } } },
    });
    let count = 0;
    for (const row of rows) {
      const profiles = await tx.userProfile.findMany({
        where: { schoolId, role: "student", studentId: row.studentId },
        select: { userId: true },
      });
      if (profiles.length === 0) continue;
      const link = `/eleve?seance=${sessionId}`;
      const userIds = profiles.map((p) => p.userId);
      const already = await tx.notification.findMany({ where: { link, userId: { in: userIds } }, select: { userId: true } });
      const done = new Set(already.map((entry) => entry.userId));
      const targets = userIds.filter((id) => !done.has(id));
      if (targets.length === 0) continue;
      const status = row.status === "absent" ? "absent" : "late";
      count += await this.notifications.notifyUsers(tx, schoolId, targets, {
        kind: status === "absent" ? "attendance.student.absent" : "attendance.student.late",
        title: studentNoticeTitle(status, row.session.date, row.session.slot),
        body: "Information de l'\u00e9cole. Tes parents en sont inform\u00e9s.",
        link,
      });
    }
    return count;
  }

  /**
   * P0-5 (CDC M3) : a la cloture, une carte « À faire » (ParentAction ouverte) par eleve
   * absent ou en retard lie a au moins un parent active : « Justifier l'absence du ... ».
   * Idempotent : une reouverture puis une nouvelle cloture ne cree pas de doublon
   * (meme eleve, meme intitule date + demi-journee).
   */
  private async createAbsenceActions(
    tx: Prisma.TransactionClient,
    schoolId: string,
    sessionId: string,
    actorId: string,
  ): Promise<number> {
    const rows = await tx.attendanceRow.findMany({
      where: { sessionId, status: { in: ["absent", "late"] } },
      select: {
        status: true,
        studentId: true,
        session: { select: { date: true, slot: true } },
        student: { select: { guardians: { where: { guardian: { userId: { not: null } } }, select: { guardianId: true } } } },
      },
    });
    const candidates = absenceActionsToCreate(
      rows.map((row) => ({
        studentId: row.studentId,
        status: row.status,
        date: row.session.date,
        slot: row.session.slot,
        linkedGuardians: row.student.guardians.length,
      })),
      new Set(),
    );
    let created = 0;
    for (const { studentId, title } of candidates) {
      const existing = await tx.parentAction.findFirst({
        where: { studentId, title },
        select: { id: true },
      });
      if (existing) continue;
      await tx.parentAction.create({
        data: {
          schoolId,
          studentId,
          title,
          description: "Envoyez un justificatif depuis votre espace famille.",
          createdById: actorId,
        },
        select: { id: true },
      });
      created += 1;
    }
    return created;
  }

  async reopen(auth: AuthContext, sessionId: string, dto: ReopenSessionDto, client: ClientInfo) {
    const context = toTenantContext(auth);
    requireSchool(auth);

    if (auth.role !== "direction" && auth.role !== "super_admin") {
      throw new ForbiddenException("Seule la direction peut rouvrir un appel.");
    }

    await this.tenancy.run(context, async (tx) => {
      const session = await tx.attendanceSession.findFirst({
        where: { id: sessionId },
        select: { id: true, status: true },
      });
      if (!session) {
        throw new NotFoundException("Session d'appel introuvable.");
      }
      if (session.status !== "closed") {
        throw new ConflictException("Seule une session clôturée peut être rouverte.");
      }

      await tx.attendanceSession.update({
        where: { id: session.id },
        data: {
          status: "open",
          reopenedAt: new Date(),
          reopenedById: auth.userId,
          reopenReason: dto.reason.slice(0, 500),
          closedAt: null,
          closedById: null,
          version: { increment: 1 },
        },
      });
    });

    await this.audit.scoped(context, {
      action: "attendance.session.reopened",
      entity: "AttendanceSession",
      entityId: sessionId,
      severity: "critical",
      metadata: { reason: dto.reason.slice(0, 200) },
      ip: client.ip,
      userAgent: client.userAgent,
    });

    return { ok: true, status: "open" };
  }

  /** Lot 2.3 : sessions existantes d'une classe pour une date (option : créneau). */
  async findSessions(
    auth: AuthContext,
    classroomId: string,
    dateRaw: string,
    slot?: "morning" | "afternoon",
  ) {
    const context = toTenantContext(auth);
    requireSchool(auth);
    const date = safeParseDate(dateRaw);
    const schoolYear = schoolYearForDate(date);

    return this.tenancy.run(context, async (tx) => {
      await this.assertCanAccessClassroom(tx, auth, classroomId, schoolYear);

      const sessions = await tx.attendanceSession.findMany({
        where: { classroomId, date, ...(slot ? { slot } : {}) },
        orderBy: { slot: "asc" },
        select: {
          id: true,
          slot: true,
          status: true,
          version: true,
          closedAt: true,
          reopenedAt: true,
          reopenReason: true,
          createdAt: true,
          _count: { select: { rows: true } },
        },
      });

      return {
        classroomId,
        date: dateRaw,
        schoolYear,
        sessions: sessions.map(({ _count, ...session }) => ({ ...session, markedCount: _count.rows })),
      };
    });
  }

  /**
   * Lot 2.3 : historique d'une session, reconstruit depuis le journal d'audit
   * (inaltérable). Lisible par la direction et l'enseignant affecté.
   */
  async history(auth: AuthContext, sessionId: string) {
    const context = toTenantContext(auth);
    const schoolId = requireSchool(auth);

    return this.tenancy.run(context, async (tx) => {
      const session = await tx.attendanceSession.findFirst({
        where: { id: sessionId },
        select: { id: true, classroomId: true, schoolYear: true },
      });
      if (!session) {
        throw new NotFoundException("Session d'appel introuvable.");
      }
      await this.assertCanAccessClassroom(tx, auth, session.classroomId, session.schoolYear);

      const entries = await tx.auditLog.findMany({
        where: { schoolId, entity: "AttendanceSession", entityId: sessionId },
        orderBy: { createdAt: "asc" },
        take: 500,
        select: { id: true, action: true, severity: true, metadata: true, actorId: true, createdAt: true },
      });

      const actorIds = [...new Set(entries.map((entry) => entry.actorId).filter((id): id is string => !!id))];
      const profiles = actorIds.length
        ? await tx.userProfile.findMany({
            where: { schoolId, userId: { in: actorIds } },
            select: { userId: true, displayName: true, role: true },
          })
        : [];
      const actorMap = new Map(profiles.map((profile) => [profile.userId, profile]));

      const studentIds = new Set<string>();
      for (const entry of entries) {
        const changes = readChanges(entry.metadata);
        for (const change of changes) {
          studentIds.add(change.studentId);
        }
      }
      const students = studentIds.size
        ? await tx.student.findMany({
            where: { id: { in: [...studentIds] } },
            select: { id: true, displayName: true, studentCode: true },
          })
        : [];
      const studentMap = new Map(students.map((student) => [student.id, student]));

      return {
        sessionId,
        entries: entries.map((entry) => {
          const actor = entry.actorId ? actorMap.get(entry.actorId) : undefined;
          const metadata = (entry.metadata ?? {}) as Record<string, unknown>;
          return {
            id: entry.id,
            action: entry.action,
            severity: entry.severity,
            createdAt: entry.createdAt,
            actor: actor ? { displayName: actor.displayName, role: actor.role } : null,
            reason: typeof metadata.reason === "string" ? metadata.reason : null,
            accepted: typeof metadata.accepted === "number" ? metadata.accepted : null,
            changes: readChanges(entry.metadata).map((change) => ({
              ...change,
              studentName: studentMap.get(change.studentId)?.displayName ?? null,
              studentCode: studentMap.get(change.studentId)?.studentCode ?? null,
            })),
          };
        }),
      };
    });
  }

  private async assertCanAccessClassroom(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    classroomId: string,
    schoolYear: string,
  ): Promise<void> {
    const classroom = await tx.classroom.findFirst({
      where: { id: classroomId },
      select: { id: true },
    });
    if (!classroom) {
      throw new NotFoundException("Classe introuvable.");
    }

    if (auth.role === "direction" || auth.role === "super_admin") {
      return;
    }

    if (auth.role !== "teacher") {
      throw new ForbiddenException("Rôle non autorisé pour l'appel.");
    }

    const assignment = await tx.teacherClassroomAssignment.findFirst({
      where: {
        teacherProfileId: auth.profileId,
        classroomId,
        schoolYear,
      },
      select: { id: true },
    });

    if (!assignment) {
      throw new ForbiddenException("Vous n'êtes pas affecté à cette classe pour cette année scolaire.");
    }
  }
}

function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) {
    throw new ForbiddenException("Un établissement actif est requis.");
  }
  return auth.schoolId;
}

function safeParseDate(value: string): Date {
  try {
    return parseCivilDate(value);
  } catch {
    throw new BadRequestException("Date invalide (attendu AAAA-MM-JJ).");
  }
}

type StatusChange = { studentId: string; from: string | null; to: string };

function readChanges(metadata: Prisma.JsonValue | null): StatusChange[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  const raw = (metadata as Record<string, unknown>).changes;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (item): item is StatusChange =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as StatusChange).studentId === "string" &&
      typeof (item as StatusChange).to === "string",
  );
}