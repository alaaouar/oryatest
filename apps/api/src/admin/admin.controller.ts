import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { AdminService } from "./admin.service";
import { CreateInvitationDto, CreateSchoolAdminDto, CreateSchoolDto } from "../activation/activation.dto";

/**
 * Console d'administration.
 * - super-admin : création et validation des établissements (CDC §4 M10) ;
 * - direction : invitations nominatives (enseignant, accompagnateur).
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("schools")
  @Roles("super_admin")
  @RequireMfa()
  async listSchools(@CurrentAuth() auth: AuthContext) {
    return { schools: await this.admin.listSchools(auth) };
  }
  @Post("schools")
  @HttpCode(201)
  @Roles("super_admin")
  @RequireMfa()
  createSchool(@CurrentAuth() auth: AuthContext, @Body() dto: CreateSchoolDto, @Req() request: Request) {
    return this.admin.createSchool(auth, dto, clientInfo(request));
  }

  @Post("schools/:id/validate")
  @HttpCode(200)
  @Roles("super_admin")
  @RequireMfa()
  validateSchool(
    @CurrentAuth() auth: AuthContext,
    @Param("id") schoolId: string,
    @Req() request: Request,
  ) {
    return this.admin.validateSchool(auth, schoolId, clientInfo(request));
  }

  @Post("schools/:id/admins")
  @HttpCode(201)
  @Roles("super_admin")
  @RequireMfa()
  createSchoolAdmin(
    @CurrentAuth() auth: AuthContext,
    @Param("id") schoolId: string,
    @Body() dto: CreateSchoolAdminDto,
    @Req() request: Request,
  ) {
    return this.admin.createSchoolAdmin(auth, schoolId, dto, clientInfo(request));
  }

  @Post("invitations")
  @HttpCode(201)
  @Roles("direction")
  @RequireMfa()
  invite(@CurrentAuth() auth: AuthContext, @Body() dto: CreateInvitationDto, @Req() request: Request) {
    return this.admin.invite(auth, dto, clientInfo(request));
  }
}
