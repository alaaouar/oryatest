import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import { schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import type { DashboardRangeDto, ReportName } from "./dashboard.dto";
import type { Table } from "./export";

type Tx = Prisma.TransactionClient;

const DEFAULT_DAYS = 30;
const MAX_DAYS = 92;
const ROW_CAP = 20_000;

/** Date civile au Maroc (les appels sont datés en heure locale de l'école). */
export function todayInMorocco(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(now);
}

function civil(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function rate(part: number, total: number): number | null {
  return total === 0 ? null : Math.round((part / total) * 1000) / 10;
}

/**
 * Tableau de bord direction (lot 7). Toutes les valeurs viennent de requêtes
 * réelles dans le contexte RLS de l'école ; une donnée absente reste à 0 ou
 * null (jamais de valeur fictive).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly tenancy: TenancyService) {}

  range(query: DashboardRangeDto) {
    const to = query.to ?? todayInMorocco();
    const from = query.from ?? day(new Date(civil(to).getTime() - (DEFAULT_DAYS - 1) * 86_400_000));
    const fromDate = civil(from);
    const toDate = civil(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) throw new BadRequestException("Dates invalides.");
    if (toDate < fromDate) throw new BadRequestException("La date de fin précède la date de début.");
    const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (days > MAX_DAYS) throw new BadRequestException(`Période limitée à ${MAX_DAYS} jours.`);
    return { from, to, fromDate, toDate, toEnd: new Date(toDate.getTime() + 86_400_000 - 1), days };
  }

  private requireSchool(auth: AuthContext) {
    if (!auth.schoolId) throw new ForbiddenException("Un établissement actif est requis.");
  }

  async summary(auth: AuthContext, query: DashboardRangeDto) {
    this.requireSchool(auth);
    const range = this.range(query);
    const today = todayInMorocco();
    const schoolYear = schoolYearForDate(civil(today));
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const [students, classes, todayBlock, unjustified, teachers, communications, pending, activity] = [
        await tx.student.count(),
        await this.classes(tx, schoolYear),
        await this.today(tx, today),
        await this.unjustified(tx, range),
        await this.teachers(tx, range, auth.schoolId as string),
        await this.communications(tx, range),
        await this.pending(tx, today),
        await this.activity(tx, range),
      ];
      const enrolled = classes.reduce((sum, entry) => sum + entry.students, 0);
      return {
        generatedAt: new Date(),
        range: { from: range.from, to: range.to, days: range.days },
        schoolYear,
        students: { total: students, enrolled, unassigned: students - enrolled },
        classes,
        today: todayBlock,
        unjustified: { total: unjustified.length, students: new Set(unjustified.map((row) => row.studentId)).size, recent: unjustified.slice(0, 20) },
        teachers,
        communications,
        pending,
        activity,
      };
    });
  }

  private async classes(tx: Tx, schoolYear: string) {
    const [classrooms, counts] = await Promise.all([
      tx.classroom.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, level: true } }),
      tx.enrollment.groupBy({ by: ["classroomId"], where: { schoolYear }, _count: { _all: true } }),
    ]);
    const map = new Map(counts.map((entry) => [entry.classroomId, entry._count._all]));
    return classrooms.map((classroom) => ({ id: classroom.id, name: classroom.name, level: classroom.level, students: map.get(classroom.id) ?? 0 }));
  }

  private async today(tx: Tx, today: string) {
    const sessions = await tx.attendanceSession.findMany({
      where: { date: civil(today) },
      select: { id: true, status: true, slot: true, classroom: { select: { name: true } } },
    });
    const ids = sessions.map((session) => session.id);
    const grouped = ids.length
      ? await tx.attendanceRow.groupBy({ by: ["status"], where: { sessionId: { in: ids } }, _count: { _all: true } })
      : [];
    const counts = { present: 0, absent: 0, late: 0 };
    for (const entry of grouped) counts[entry.status] = entry._count._all;
    const classesTotal = await tx.classroom.count();
    const classesWithSession = new Set(sessions.map((session) => session.classroom.name)).size;
    return {
      date: today,
      sessions: {
        opened: sessions.length,
        open: sessions.filter((session) => session.status === "open").length,
        closed: sessions.filter((session) => session.status === "closed").length,
      },
      classesWithoutSession: Math.max(0, classesTotal - classesWithSession),
      ...counts,
      marked: counts.present + counts.absent + counts.late,
    };
  }

  /** Absences / retards de la période sans justificatif accepté couvrant la date. */
  private async unjustified(tx: Tx, range: ReturnType<DashboardService["range"]>) {
    const rows = await tx.attendanceRow.findMany({
      where: { status: { in: ["absent", "late"] }, session: { date: { gte: range.fromDate, lte: range.toDate } } },
      orderBy: { session: { date: "desc" } },
      take: ROW_CAP,
      select: {
        status: true,
        studentId: true,
        student: { select: { displayName: true, studentCode: true } },
        session: { select: { date: true, slot: true, classroom: { select: { name: true } } } },
      },
    });
    if (rows.length === 0) return [];
    const studentIds = [...new Set(rows.map((row) => row.studentId))];
    const accepted = await tx.absenceJustification.findMany({
      where: {
        status: "accepted",
        studentId: { in: studentIds },
        fromDate: { lte: range.toDate },
        toDate: { gte: range.fromDate },
      },
      select: { studentId: true, fromDate: true, toDate: true },
    });
    const byStudent = new Map<string, { fromDate: Date; toDate: Date }[]>();
    for (const entry of accepted) byStudent.set(entry.studentId, [...(byStudent.get(entry.studentId) ?? []), entry]);
    return rows
      .filter((row) => !(byStudent.get(row.studentId) ?? []).some((entry) => entry.fromDate <= row.session.date && row.session.date <= entry.toDate))
      .map((row) => ({
        studentId: row.studentId,
        student: row.student.displayName,
        studentCode: row.student.studentCode,
        classroom: row.session.classroom.name,
        date: day(row.session.date),
        slot: row.session.slot,
        status: row.status,
      }));
  }

  private async teachers(tx: Tx, range: ReturnType<DashboardService["range"]>, schoolId: string) {
    const profiles = await tx.userProfile.findMany({
      where: { role: "teacher", schoolId },
      orderBy: { displayName: "asc" },
      select: { userId: true, displayName: true },
    });
    if (profiles.length === 0) return [];
    const userIds = profiles.map((profile) => profile.userId);
    const dateWindow = { gte: range.fromDate, lte: range.toDate };
    const timeWindow = { gte: range.fromDate, lte: range.toEnd };
    const [opened, closed, agenda, messages] = await Promise.all([
      tx.attendanceSession.groupBy({ by: ["openedById"], where: { date: dateWindow, openedById: { in: userIds } }, _count: { _all: true } }),
      tx.attendanceSession.groupBy({ by: ["closedById"], where: { date: dateWindow, closedById: { in: userIds } }, _count: { _all: true } }),
      tx.agendaItem.groupBy({ by: ["authorId"], where: { createdAt: timeWindow, authorId: { in: userIds } }, _count: { _all: true } }),
      tx.message.groupBy({ by: ["authorId"], where: { createdAt: timeWindow, authorId: { in: userIds } }, _count: { _all: true } }),
    ]);
    const toMap = <K extends string>(list: ({ _count: { _all: number } } & Record<K, string | null>)[], key: K) =>
      new Map(list.map((entry) => [entry[key] as string, entry._count._all]));
    const openedMap = toMap(opened, "openedById");
    const closedMap = toMap(closed, "closedById");
    const agendaMap = toMap(agenda, "authorId");
    const messageMap = toMap(messages, "authorId");
    return profiles.map((profile) => ({
      name: profile.displayName,
      sessionsOpened: openedMap.get(profile.userId) ?? 0,
      sessionsClosed: closedMap.get(profile.userId) ?? 0,
      agendaPublished: agendaMap.get(profile.userId) ?? 0,
      messagesSent: messageMap.get(profile.userId) ?? 0,
    }));
  }

  private async communications(tx: Tx, range: ReturnType<DashboardService["range"]>) {
    const where = { createdAt: { gte: range.fromDate, lte: range.toEnd } };
    const [byKind, recipients, read, ackExpected, acked] = await Promise.all([
      tx.message.groupBy({ by: ["kind"], where, _count: { _all: true } }),
      tx.messageRecipient.count({ where: { message: where } }),
      tx.messageRecipient.count({ where: { message: where, readAt: { not: null } } }),
      tx.messageRecipient.count({ where: { message: { ...where, requiresAck: true } } }),
      tx.messageRecipient.count({ where: { message: { ...where, requiresAck: true }, acknowledgedAt: { not: null } } }),
    ]);
    const kinds = { announcement: 0, event: 0, class_message: 0, direct: 0 };
    for (const entry of byKind) kinds[entry.kind] = entry._count._all;
    const sent = Object.values(kinds).reduce((sum, value) => sum + value, 0);
    return {
      sent,
      byKind: kinds,
      recipients,
      read,
      readRate: rate(read, recipients),
      ackExpected,
      acknowledged: acked,
      ackRate: rate(acked, ackExpected),
    };
  }

  private async pending(tx: Tx, today: string) {
    const [justifications, actionsOpen, actionsOverdue, oldest] = await Promise.all([
      tx.absenceJustification.count({ where: { status: "pending" } }),
      tx.parentAction.count({ where: { status: "open" } }),
      tx.parentAction.count({ where: { status: "open", dueDate: { lt: civil(today) } } }),
      tx.absenceJustification.findFirst({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    return { justifications, oldestJustificationAt: oldest?.createdAt ?? null, actionsOpen, actionsOverdue };
  }

  /** Indicateurs par jour sur la période. */
  private async activity(tx: Tx, range: ReturnType<DashboardService["range"]>) {
    const sessions = await tx.attendanceSession.findMany({
      where: { date: { gte: range.fromDate, lte: range.toDate } },
      select: { id: true, date: true, status: true },
      take: ROW_CAP,
    });
    const sessionDay = new Map(sessions.map((session) => [session.id, day(session.date)]));
    const rowCounts = sessions.length
      ? await tx.attendanceRow.groupBy({
          by: ["sessionId", "status"],
          where: { sessionId: { in: sessions.map((session) => session.id) } },
          _count: { _all: true },
        })
      : [];
    const [messages, agenda, justifications] = await Promise.all([
      tx.message.findMany({ where: { createdAt: { gte: range.fromDate, lte: range.toEnd } }, select: { createdAt: true }, take: ROW_CAP }),
      tx.agendaItem.findMany({ where: { createdAt: { gte: range.fromDate, lte: range.toEnd } }, select: { createdAt: true }, take: ROW_CAP }),
      tx.absenceJustification.findMany({ where: { createdAt: { gte: range.fromDate, lte: range.toEnd } }, select: { createdAt: true }, take: ROW_CAP }),
    ]);

    const days = new Map<string, { date: string; sessions: number; closed: number; present: number; absent: number; late: number; messages: number; agenda: number; justifications: number }>();
    for (let index = 0; index < range.days; index += 1) {
      const key = day(new Date(range.fromDate.getTime() + index * 86_400_000));
      days.set(key, { date: key, sessions: 0, closed: 0, present: 0, absent: 0, late: 0, messages: 0, agenda: 0, justifications: 0 });
    }
    for (const session of sessions) {
      const entry = days.get(day(session.date));
      if (!entry) continue;
      entry.sessions += 1;
      if (session.status === "closed") entry.closed += 1;
    }
    for (const row of rowCounts) {
      const entry = days.get(sessionDay.get(row.sessionId) ?? "");
      if (entry) entry[row.status] += row._count._all;
    }
    // Horodatages ramenés au jour civil marocain.
    const bump = (list: { createdAt: Date }[], field: "messages" | "agenda" | "justifications") => {
      for (const item of list) {
        const entry = days.get(todayInMorocco(item.createdAt));
        if (entry) entry[field] += 1;
      }
    };
    bump(messages, "messages");
    bump(agenda, "agenda");
    bump(justifications, "justifications");
    const list = [...days.values()];
    const hasData = list.some((entry) => entry.sessions + entry.messages + entry.agenda + entry.justifications > 0);
    return { hasData, days: list };
  }

  /** Rapport tabulaire pour export (mêmes requêtes que l'écran). */
  async report(auth: AuthContext, name: ReportName, query: DashboardRangeDto): Promise<Table> {
    const data = await this.summary(auth, query);
    const period = `${data.range.from}_${data.range.to}`;
    switch (name) {
      case "classes":
        return {
          title: `Effectifs ${data.schoolYear}`,
          columns: ["Classe", "Niveau", "Élèves inscrits"],
          rows: data.classes.map((entry) => [entry.name, entry.level ?? "", entry.students]),
        };
      case "today":
        return {
          title: `Appel ${data.today.date}`,
          columns: ["Date", "Séances ouvertes", "Séances clôturées", "Classes sans appel", "Présents", "Absents", "Retards"],
          rows: [[data.today.date, data.today.sessions.opened, data.today.sessions.closed, data.today.classesWithoutSession, data.today.present, data.today.absent, data.today.late]],
        };
      case "teachers":
        return {
          title: `Enseignants ${period}`,
          columns: ["Enseignant", "Appels ouverts", "Appels clôturés", "Devoirs et agenda publiés", "Messages envoyés"],
          rows: data.teachers.map((entry) => [entry.name, entry.sessionsOpened, entry.sessionsClosed, entry.agendaPublished, entry.messagesSent]),
        };
      case "unjustified": {
        const full = await this.tenancy.run(toTenantContext(auth), (tx) => this.unjustified(tx, this.range(query)));
        return {
          title: `Non justifiées ${period}`,
          columns: ["Date", "Créneau", "Classe", "Code élève", "Élève", "Type"],
          rows: full.map((row) => [row.date, row.slot === "morning" ? "Matin" : "Après-midi", row.classroom, row.studentCode, row.student, row.status === "absent" ? "Absence" : "Retard"]),
        };
      }
      case "activity":
        return {
          title: `Activité ${period}`,
          columns: ["Date", "Séances", "Clôturées", "Présents", "Absents", "Retards", "Messages", "Agenda", "Justificatifs reçus"],
          rows: data.activity.days.map((entry) => [entry.date, entry.sessions, entry.closed, entry.present, entry.absent, entry.late, entry.messages, entry.agenda, entry.justifications]),
        };
      case "communications": {
        const c = data.communications;
        return {
          title: `Communications ${period}`,
          columns: ["Messages envoyés", "Annonces", "Événements", "Messages de classe", "Échanges individuels", "Destinataires", "Lus", "Taux de lecture (%)", "Accusés attendus", "Accusés reçus", "Taux d'accusé (%)"],
          rows: [[c.sent, c.byKind.announcement, c.byKind.event, c.byKind.class_message, c.byKind.direct, c.recipients, c.read, c.readRate, c.ackExpected, c.acknowledged, c.ackRate]],
        };
      }
    }
  }
}
