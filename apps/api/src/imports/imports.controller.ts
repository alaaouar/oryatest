import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { ImportsService } from "./imports.service";
import { StartImportDto } from "./imports.dto";

/** 20 aperçus / minute par défaut ; surchargeable pour les suites de tests. */
const IMPORT_RATE_LIMIT = Number(process.env.IMPORT_RATE_LIMIT ?? "20");

/**
 * Import des listes (CDC §4 M2). Réservé à la direction et au super-admin,
 * avec second facteur : un import écrit des données d'élèves.
 */
@Controller("imports")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction", "super_admin")
@RequireMfa()
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: IMPORT_RATE_LIMIT, ttl: 60_000 } })
  start(@CurrentAuth() auth: AuthContext, @Body() dto: StartImportDto, @Req() request: Request) {
    return this.imports.start(auth, dto, clientInfo(request));
  }

  @Get(":id")
  get(@CurrentAuth() auth: AuthContext, @Param("id") jobId: string) {
    return this.imports.get(auth, jobId);
  }

  @Post(":id/commit")
  @HttpCode(200)
  commit(@CurrentAuth() auth: AuthContext, @Param("id") jobId: string, @Req() request: Request) {
    return this.imports.commit(auth, jobId, clientInfo(request));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@CurrentAuth() auth: AuthContext, @Param("id") jobId: string, @Req() request: Request) {
    return this.imports.cancel(auth, jobId, clientInfo(request));
  }
}
