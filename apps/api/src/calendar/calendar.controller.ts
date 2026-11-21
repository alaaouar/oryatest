import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { DayQueryDto, HolidayDto, WorkingDaysDto } from "./calendar.dto";
import { CalendarService } from "./calendar.service";

/** t92 (CDC M2) : calendrier de l'établissement. Lecture : équipe ; modification : direction (MFA). */
@Controller("calendar")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction", "teacher")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  get(@CurrentAuth() auth: AuthContext) {
    return this.calendar.get(auth);
  }

  @Get("day")
  day(@CurrentAuth() auth: AuthContext, @Query() query: DayQueryDto) {
    return this.calendar.day(auth, query.date);
  }

  @Put("working-days")
  @Roles("direction")
  @RequireMfa()
  setWorkingDays(@CurrentAuth() auth: AuthContext, @Body() dto: WorkingDaysDto, @Req() request: Request) {
    return this.calendar.setWorkingDays(auth, dto, clientInfo(request));
  }

  @Post("holidays")
  @HttpCode(201)
  @Roles("direction")
  @RequireMfa()
  addHoliday(@CurrentAuth() auth: AuthContext, @Body() dto: HolidayDto, @Req() request: Request) {
    return this.calendar.addHoliday(auth, dto, clientInfo(request));
  }

  @Delete("holidays/:id")
  @Roles("direction")
  @RequireMfa()
  deleteHoliday(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.calendar.deleteHoliday(auth, id, clientInfo(request));
  }
}
