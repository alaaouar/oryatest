import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { StudentAccountService } from "./student-account.service";
import { InviteStudentDto } from "./student-space.dto";
import { StudentSpaceService } from "./student-space.service";

/** Espace eleve : uniquement des GET (consultation seule). */
@Controller("student")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("student")
export class StudentSpaceController {
  constructor(private readonly space: StudentSpaceService) {}

  @Get("me")
  me(@CurrentAuth() auth: AuthContext) {
    return this.space.me(auth);
  }

  @Get("agenda")
  agenda(@CurrentAuth() auth: AuthContext) {
    return this.space.agenda(auth);
  }

  @Get("attendance")
  attendance(@CurrentAuth() auth: AuthContext) {
    return this.space.attendance(auth);
  }

  @Get("justifications")
  justifications(@CurrentAuth() auth: AuthContext) {
    return this.space.justifications(auth);
  }

  @Get("bus")
  bus(@CurrentAuth() auth: AuthContext) {
    return this.space.bus(auth);
  }

  /** t92 (CDC M7) : resultats publies de l'eleve connecte. */
  @Get("results")
  results(@CurrentAuth() auth: AuthContext) {
    return this.space.results(auth);
  }

  /** t92 (CDC M3) : informations de l'ecole (absence / retard enregistres a la cloture). */
  @Get("notifications")
  notifications(@CurrentAuth() auth: AuthContext) {
    return this.space.notifications(auth);
  }
}

/** Direction : invitation du compte eleve (consentement parental actif requis). */
@Controller("students/:studentId/student-account")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class StudentAccountController {
  constructor(private readonly accounts: StudentAccountService) {}

  @Post()
  @Roles("direction")
  @RequireMfa()
  @HttpCode(201)
  invite(
    @CurrentAuth() auth: AuthContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Body() dto: InviteStudentDto,
    @Req() request: Request,
  ) {
    return this.accounts.invite(auth, studentId, dto.email, clientInfo(request));
  }
}