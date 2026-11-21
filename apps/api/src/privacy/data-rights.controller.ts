import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { DataRightsService } from "./data-rights.service";
import { SELF_ROLES } from "./privacy.controller";
import { CloseDataRightsDto, CreateDataRightsDto, DataRightsQueryDto } from "./privacy.dto";

/** Bloc 4 : rectification et opposition (demande tracee adressee a l'ecole). */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class DataRightsController {
  constructor(private readonly rights: DataRightsService) {}

  @Post("me/data-rights")
  @Roles(...SELF_ROLES)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(201)
  createRights(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDataRightsDto, @Req() request: Request) {
    return this.rights.create(auth, dto, clientInfo(request));
  }

  @Get("me/data-rights")
  @Roles(...SELF_ROLES)
  myRights(@CurrentAuth() auth: AuthContext) {
    return this.rights.listMine(auth);
  }

  @Get("data-rights")
  @Roles("direction")
  @RequireMfa()
  schoolRights(@CurrentAuth() auth: AuthContext, @Query() query: DataRightsQueryDto) {
    return this.rights.listForSchool(auth, query.status);
  }

  @Post("data-rights/:id/close")
  @Roles("direction")
  @RequireMfa()
  @HttpCode(200)
  closeRights(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CloseDataRightsDto,
    @Req() request: Request,
  ) {
    return this.rights.close(auth, id, dto, clientInfo(request));
  }
}
