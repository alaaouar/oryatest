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
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { ParentActionsService } from "./actions.service";
import { JustificationsService, type MulterFile } from "./justifications.service";
import { MAX_UPLOAD_BYTES, type DownloadTarget } from "../storage/storage.service";
import { NotificationsService } from "./notifications.service";
import {
  CreateParentActionDto,
  ListJustificationsQueryDto,
  ListParentActionsQueryDto,
  CompleteJustificationDto,
  ReviewJustificationDto,
  SubmitJustificationDto,
} from "./parent-space.dto";

const UPLOAD_RATE_LIMIT = Number(process.env.UPLOAD_RATE_LIMIT ?? "20");

/**
 * Multipart (multer, memoire) : 1 fichier "file", 10 Mo maximum (413 au-dela),
 * type reel controle ensuite par magic bytes (StorageService).
 */
export const UPLOAD_INTERCEPTOR = FileInterceptor("file", {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 12, parts: 14 },
});

/** Reponse de telechargement : URL pre-signee courte (S3) ou flux prive (local). */
export async function sendDownload(response: Response, target: DownloadTarget) {
  if (target.kind === "url") {
    response.set({ "Cache-Control": "private, no-store" });
    return { url: target.url, expiresInSeconds: target.expiresInSeconds };
  }
  return sendFile(response, target);
}

/** Envoi d'un fichier privé : jamais affiché en ligne, jamais mis en cache. */
export async function sendFile(
  response: Response,
  file: { stream: NodeJS.ReadableStream; mimeType: string; sizeBytes: number; name: string },
) {
  response.set({
    "Content-Type": file.mimeType,
    "Content-Length": String(file.sizeBytes),
    "Content-Disposition": `attachment; filename="justificatif"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  return new StreamableFile(file.stream as never);
}

/** Espace parent : justificatifs et actions demandées, limités aux enfants du compte. */
@Controller("family")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("parent")
export class FamilySpaceController {
  constructor(
    private readonly justifications: JustificationsService,
    private readonly actions: ParentActionsService,
  ) {}

  @Get("justifications")
  async justificationList(@CurrentAuth() auth: AuthContext) {
    return {
      justifications: await this.justifications.listForParent(auth),
      // t50u : statut seul des envois du co-responsable (parametre JUSTIFICATION_COGUARDIAN_STATUS).
      coGuardian: await this.justifications.coGuardianStatusesForParent(auth),
    };
  }

  @Post("justifications")
  @HttpCode(201)
  @Throttle({ default: { limit: UPLOAD_RATE_LIMIT, ttl: 60_000 } })
  @UseInterceptors(UPLOAD_INTERCEPTOR)
  submit(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SubmitJustificationDto,
    @Req() request: Request,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.justifications.submit(auth, dto, clientInfo(request), file);
  }

  /** t92 M4 : complement d'un justificatif « a completer » (parent auteur ; motif et/ou piece). */
  @Post("justifications/:id/complete")
  @HttpCode(200)
  @Throttle({ default: { limit: UPLOAD_RATE_LIMIT, ttl: 60_000 } })
  @UseInterceptors(UPLOAD_INTERCEPTOR)
  completeJustification(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CompleteJustificationDto,
    @Req() request: Request,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.justifications.complete(auth, id, dto, clientInfo(request), file);
  }

  /** Decision t49u : le parent auteur telecharge sa propre piece ; tout autre parent : 404. */
  @Get("justifications/:id/file")
  async file(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendDownload(response, await this.justifications.fileFor(auth, id));
  }

  @Get("actions")
  async actionList(@CurrentAuth() auth: AuthContext) {
    // t92 M4 : 5 cartes ouvertes au plus (les plus urgentes), total et nombre masque.
    return this.actions.listForParent(auth);
  }

  @Post("actions/:id/done")
  @HttpCode(200)
  complete(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.actions.complete(auth, id, clientInfo(request));
  }
}

/** Enseignant : statut des justificatifs d'un eleve de ses classes, sans motif ni piece. */
@Controller("justification-status")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("teacher")
export class JustificationStatusController {
  constructor(private readonly justifications: JustificationsService) {}

  @Get(":studentId")
  async status(@CurrentAuth() auth: AuthContext, @Param("studentId", ParseUUIDPipe) studentId: string) {
    return { justifications: await this.justifications.statusForTeacher(auth, studentId) };
  }
}

/** Côté école : examen des justificatifs (direction, MFA pour décider). */
@Controller("justifications")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction")
export class JustificationsController {
  constructor(private readonly justifications: JustificationsService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query() query: ListJustificationsQueryDto) {
    return { justifications: await this.justifications.listForSchool(auth, query) };
  }

  @Get(":id/file")
  async file(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendDownload(response, await this.justifications.fileFor(auth, id));
  }

  @Post(":id/review")
  @HttpCode(200)
  @RequireMfa()
  review(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReviewJustificationDto,
    @Req() request: Request,
  ) {
    return this.justifications.review(auth, id, dto, clientInfo(request));
  }
}

/** Côté école : actions demandées aux familles. */
@Controller("parent-actions")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction")
export class ParentActionsController {
  constructor(private readonly actions: ParentActionsService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query() query: ListParentActionsQueryDto) {
    return { actions: await this.actions.listForSchool(auth, query) };
  }

  @Post()
  @HttpCode(201)
  @RequireMfa()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateParentActionDto, @Req() request: Request) {
    return this.actions.create(auth, dto, clientInfo(request));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequireMfa()
  cancel(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.actions.cancel(auth, id, clientInfo(request));
  }
}

/** Notifications in-app du compte connecté, quel que soit son rôle d'école. */
@Controller("notifications")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("parent", "teacher", "direction", "bus_attendant", "chauffeur")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext) {
    return this.notifications.list(auth);
  }

  @Post("read-all")
  @HttpCode(200)
  readAll(@CurrentAuth() auth: AuthContext) {
    return this.notifications.markAllRead(auth);
  }

  @Post(":id/read")
  @HttpCode(200)
  read(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.notifications.markRead(auth, id);
  }
}
