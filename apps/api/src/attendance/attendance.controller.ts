import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import {
  AttendanceMarkDto,
  BulkAttendanceDto,
  FindSessionsQueryDto,
  OpenSessionDto,
  ReopenSessionDto,
  SyncAttendanceDto,
} from "./attendance.dto";
import { AttendanceService } from "./attendance.service";

@Controller("attendance")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction", "teacher", "super_admin")
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get("classrooms/:classroomId/roster")
  roster(
    @CurrentAuth() auth: AuthContext,
    @Param("classroomId") classroomId: string,
    @Query("date") date: string,
  ) {
    return this.attendance.roster(auth, classroomId, date);
  }

  @Post("sessions")
  @HttpCode(201)
  open(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: OpenSessionDto,
    @Req() request: Request,
  ) {
    return this.attendance.open(auth, dto, clientInfo(request));
  }

  /** Lot 2.3 : retrouver les sessions d'une classe pour une date (et un créneau). */
  @Get("sessions")
  find(@CurrentAuth() auth: AuthContext, @Query() query: FindSessionsQueryDto) {
    return this.attendance.findSessions(auth, query.classroomId, query.date, query.slot);
  }

  /** Lot 2.3 : historique des modifications d'une session (journal d'audit). */
  @Get("sessions/:id/history")
  history(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) sessionId: string) {
    return this.attendance.history(auth, sessionId);
  }

  @Get("sessions/:id")
  get(@CurrentAuth() auth: AuthContext, @Param("id") sessionId: string) {
    return this.attendance.get(auth, sessionId);
  }

  @Post("sessions/:id/rows")
  @HttpCode(200)
  markOne(
    @CurrentAuth() auth: AuthContext,
    @Param("id") sessionId: string,
    @Body() dto: AttendanceMarkDto,
    @Req() request: Request,
  ) {
    return this.attendance.markOne(auth, sessionId, dto, clientInfo(request));
  }

  @Post("sessions/:id/rows/bulk")
  @HttpCode(200)
  markBulk(
    @CurrentAuth() auth: AuthContext,
    @Param("id") sessionId: string,
    @Body() dto: BulkAttendanceDto,
    @Req() request: Request,
  ) {
    return this.attendance.markMany(auth, sessionId, dto, clientInfo(request));
  }

  /** F03 / B11 (ADR-003) : file hors ligne rejouee a la reconnexion (idempotent). */
  @Post("sessions/:id/sync")
  @HttpCode(200)
  sync(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) sessionId: string,
    @Body() dto: SyncAttendanceDto,
    @Req() request: Request,
  ) {
    return this.attendance.sync(auth, sessionId, dto, clientInfo(request));
  }

  @Post("sessions/:id/close")
  @HttpCode(200)
  close(
    @CurrentAuth() auth: AuthContext,
    @Param("id") sessionId: string,
    @Req() request: Request,
  ) {
    return this.attendance.close(auth, sessionId, clientInfo(request));
  }

  @Post("sessions/:id/reopen")
  @HttpCode(200)
  @Roles("direction", "super_admin")
  reopen(
    @CurrentAuth() auth: AuthContext,
    @Param("id") sessionId: string,
    @Body() dto: ReopenSessionDto,
    @Req() request: Request,
  ) {
    return this.attendance.reopen(auth, sessionId, dto, clientInfo(request));
  }
}
