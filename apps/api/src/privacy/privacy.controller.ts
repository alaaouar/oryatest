import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { sendDownload } from "../parent-space/controllers";
import { DataExportService } from "./data-export.service";

export const SELF_ROLES = ["parent", "student", "teacher", "bus_attendant", "chauffeur", "direction"] as const;

/** Bloc 4 : droit d'acces (export JSON + PDF). */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class PrivacyController {
  constructor(
    private readonly exports: DataExportService,
  ) {}

  @Post("me/data-export")
  @Roles(...SELF_ROLES)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  requestExport(@CurrentAuth() auth: AuthContext, @Req() request: Request) {
    return this.exports.request(auth, clientInfo(request));
  }

  @Get("me/data-export")
  @Roles(...SELF_ROLES)
  listExports(@CurrentAuth() auth: AuthContext) {
    return this.exports.list(auth);
  }

  @Get("me/data-export/:id/json")
  @Roles(...SELF_ROLES)
  async json(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendDownload(response, await this.exports.download(auth, id, "json", clientInfo(request)));
  }

  @Get("me/data-export/:id/pdf")
  @Roles(...SELF_ROLES)
  async pdf(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendDownload(response, await this.exports.download(auth, id, "pdf", clientInfo(request)));
  }
}
