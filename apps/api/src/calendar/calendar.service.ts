import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { toTenantContext, type AuthContext } from "../auth/auth.types";
import type { ClientInfo } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { DEFAULT_WORKING_DAYS, MAX_HOLIDAY_DAYS, normalizeWorkingDays, spanDays } from "../core/calendar-rules";
import { parseCivilDate, schoolYearForDate } from "../core/school-year";
import { TenancyService } from "../core/tenancy.service";
import { schoolDayIn } from "./calendar.query";
import type { HolidayDto, WorkingDaysDto } from "./calendar.dto";

const HOLIDAY_SELECT = { id: true, label: true, startDate: true, endDate: true, createdAt: true } as const;

function requireSchool(auth: AuthContext): string {
  if (!auth.schoolId) throw new ForbiddenException("Un établissement actif est requis.");
  return auth.schoolId;
}

function civil(value: string, label: string): Date {
  try {
    return parseCivilDate(value);
  } catch {
    throw new BadRequestException(`${label} invalide (attendu AAAA-MM-JJ).`);
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * t92 (CDC M2) : calendrier configurable de l'établissement (fuseau Africa/Casablanca par défaut) :
 * jours ouvrés et périodes de vacances / jours fériés. Effets : l'appel ne s'ouvre pas un jour de
 * vacances ni (calendrier configuré) un jour non ouvré ; le rappel de 7h45 suit le calendrier.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly audit: AuditService,
  ) {}

  async get(auth: AuthContext) {
    const schoolId = requireSchool(auth);
    return this.tenancy.run(toTenantContext(auth), async (tx) => {
      const [school, calendar, holidays] = await Promise.all([
        tx.school.findFirst({ where: { id: schoolId }, select: { timezone: true } }),
        tx.schoolCalendar.findFirst({ where: { schoolId }, select: { workingDays: true, updatedAt: true } }),
        tx.schoolHoliday.findMany({ where: { schoolId }, orderBy: { startDate: "asc" }, take: 200, select: HOLIDAY_SELECT }),
      ]);
      return {
        timezone: school?.timezone ?? "Africa/Casablanca",
        schoolYear: schoolYearForDate(new Date()),
        configured: !!calendar,
        workingDays: calendar?.workingDays ?? [...DEFAULT_WORKING_DAYS],
        updatedAt: calendar?.updatedAt ?? null,
        holidays: holidays.map(toHolidayView),
      };
    });
  }

  async day(auth: AuthContext, dateRaw: string) {
    const schoolId = requireSchool(auth);
    const date = civil(dateRaw, "Date");
    const status = await this.tenancy.run(toTenantContext(auth), (tx) => schoolDayIn(tx, schoolId, date));
    return {
      date: dateRaw,
      schoolDay: status.schoolDay,
      reason: status.reason,
      configured: status.configured,
      holiday: status.holiday ? toHolidayView(status.holiday) : null,
    };
  }

  async setWorkingDays(auth: AuthContext, dto: WorkingDaysDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    let workingDays: number[];
    try {
      workingDays = normalizeWorkingDays(dto.workingDays);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Jours ouvrés invalides.");
    }
    const context = toTenantContext(auth);
    await this.tenancy.run(context, (tx) =>
      tx.schoolCalendar.upsert({
        where: { schoolId },
        create: { schoolId, workingDays, updatedById: auth.userId },
        update: { workingDays, updatedById: auth.userId },
        select: { schoolId: true },
      }),
    );
    await this.audit.scoped(context, {
      action: "calendar.working_days.updated",
      entity: "SchoolCalendar",
      entityId: schoolId,
      metadata: { workingDays },
      ...client,
    });
    return this.get(auth);
  }

  async addHoliday(auth: AuthContext, dto: HolidayDto, client: ClientInfo) {
    const schoolId = requireSchool(auth);
    const start = civil(dto.startDate, "Date de début");
    const end = civil(dto.endDate, "Date de fin");
    if (end < start) throw new BadRequestException("La date de fin précède la date de début.");
    if (spanDays(start, end) > MAX_HOLIDAY_DAYS) {
      throw new BadRequestException(`Une période de vacances dure ${MAX_HOLIDAY_DAYS} jours au plus.`);
    }
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, (tx) =>
      tx.schoolHoliday.create({
        data: { schoolId, label: dto.label.trim(), startDate: start, endDate: end, createdById: auth.userId },
        select: HOLIDAY_SELECT,
      }),
    );
    await this.audit.scoped(context, {
      action: "calendar.holiday.created",
      entity: "SchoolHoliday",
      entityId: row.id,
      metadata: { label: row.label, startDate: dto.startDate, endDate: dto.endDate },
      ...client,
    });
    return toHolidayView(row);
  }

  async deleteHoliday(auth: AuthContext, id: string, client: ClientInfo) {
    requireSchool(auth);
    const context = toTenantContext(auth);
    const row = await this.tenancy.run(context, async (tx) => {
      const current = await tx.schoolHoliday.findFirst({ where: { id }, select: HOLIDAY_SELECT });
      if (!current) throw new NotFoundException("Période introuvable.");
      await tx.schoolHoliday.delete({ where: { id }, select: { id: true } });
      return current;
    });
    await this.audit.scoped(context, {
      action: "calendar.holiday.deleted",
      entity: "SchoolHoliday",
      entityId: id,
      metadata: { label: row.label, startDate: iso(row.startDate), endDate: iso(row.endDate) },
      ...client,
    });
    return { ok: true };
  }
}

function toHolidayView(row: { id: string; label: string; startDate: Date; endDate: Date }) {
  return { id: row.id, label: row.label, startDate: iso(row.startDate), endDate: iso(row.endDate) };
}
