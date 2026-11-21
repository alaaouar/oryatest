import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";
import { Throttle } from "@nestjs/throttler";
import type { MulterFile } from "../parent-space/justifications.service";
import { sendDownload, UPLOAD_INTERCEPTOR } from "../parent-space/controllers";
import { ConsentScanService } from "./consent-scan.service";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { ConsentService } from "./consent.service";
import { ConsentOverviewService } from "./consent-overview.service";
import { CreateConsentTextDto, GrantParentalConsentDto, PaperParentalConsentDto, ValidateConsentTextDto } from "./consent.dto";

/** t52u : meme plafond que les autres routes d'envoi de fichier (UPLOAD_RATE_LIMIT / minute). */
const UPLOAD_RATE_LIMIT = Number(process.env.UPLOAD_RATE_LIMIT ?? "20");

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class ConsentController {
  constructor(
    private readonly consents: ConsentService,
    private readonly scans: ConsentScanService,
    private readonly overviews: ConsentOverviewService,
  ) {}

  /**
   * Ecran direction « Consentements » (t74u) : apercu en lecture seule de l'ecole du jeton
   * (textes et versions, compteurs, statut par eleve, historique). Direction uniquement :
   * enseignant, parent, eleve, accompagnateur et super-admin recoivent 403.
   */
  @Get("consents/overview")
  @Roles("direction")
  overview(@CurrentAuth() auth: AuthContext) {
    return this.overviews.overview(auth);
  }

  @Get("consent-texts/current")
  @Roles("parent", "direction", "teacher", "super_admin", "student", "bus_attendant", "chauffeur")
  current(@CurrentAuth() auth: AuthContext, @Query("purpose") purpose?: string, @Query("locale") locale?: string) {
    const p = purpose === "transport_alerts" ? "transport_alerts" : "student_account";
    const l = locale === "ar" ? "ar" : "fr";
    return this.consents.currentText(auth, p, l);
  }

  @Get("admin/consent-texts")
  @Roles("super_admin")
  list(@CurrentAuth() auth: AuthContext) {
    return this.consents.listTexts(auth).then((texts) => ({ texts }));
  }

  @Post("admin/consent-texts")
  @Roles("super_admin")
  @HttpCode(201)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateConsentTextDto) {
    return this.consents.createText(auth, dto);
  }

  @Post("admin/consent-texts/validate")
  @Roles("super_admin")
  @RequireMfa()
  @HttpCode(200)
  validate(@CurrentAuth() auth: AuthContext, @Body() dto: ValidateConsentTextDto) {
    return this.consents.validateText(auth, dto);
  }

  @Get("family/children/:studentId/consents")
  @Roles("parent")
  familyList(@CurrentAuth() auth: AuthContext, @Param("studentId", ParseUUIDPipe) studentId: string) {
    return this.consents.listForStudent(auth, studentId).then((consents) => ({ consents }));
  }

  @Post("family/children/:studentId/consents")
  @Roles("parent")
  @HttpCode(201)
  familyGrant(
    @CurrentAuth() auth: AuthContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Body() dto: GrantParentalConsentDto,
    @Req() request: Request,
  ) {
    return this.consents.grantByParent(auth, studentId, dto, clientInfo(request));
  }

  @Post("family/children/:studentId/consents/:id/revoke")
  @Roles("parent")
  @HttpCode(200)
  familyRevoke(
    @CurrentAuth() auth: AuthContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.consents.revoke(auth, studentId, id, clientInfo(request));
  }

  @Get("students/:studentId/consents")
  @Roles("direction", "super_admin")
  schoolList(@CurrentAuth() auth: AuthContext, @Param("studentId", ParseUUIDPipe) studentId: string) {
    return this.consents.listForStudent(auth, studentId).then((consents) => ({ consents }));
  }

  @Post("students/:studentId/consents/paper")
  @Roles("direction")
  @HttpCode(201)
  paper(
    @CurrentAuth() auth: AuthContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Body() dto: PaperParentalConsentDto,
    @Req() request: Request,
  ) {
    return this.consents.grantPaper(auth, studentId, dto, clientInfo(request));
  }

  /** Bloc 3 : scan du formulaire papier (multipart "file"), administration uniquement. */
  @Post("students/:studentId/consents/:id/scan")
  @Roles("direction")
  @HttpCode(201)
  @Throttle({ default: { limit: UPLOAD_RATE_LIMIT, ttl: 60_000 } })
  @UseInterceptors(UPLOAD_INTERCEPTOR)
  attachScan(
    @CurrentAuth() auth: AuthContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: Request,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.scans.attach(auth, studentId, id, file, clientInfo(request));
  }

  @Get("students/:studentId/consents/:id/scan")
  @Roles("direction")
  async downloadScan(
    @CurrentAuth() auth: AuthContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendDownload(response, await this.scans.download(auth, studentId, id));
  }

  @Post("students/:studentId/consents/:id/revoke")
  @Roles("direction", "super_admin")
  @HttpCode(200)
  schoolRevoke(
    @CurrentAuth() auth: AuthContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: Request,
  ) {
    return this.consents.revoke(auth, studentId, id, clientInfo(request));
  }
}
