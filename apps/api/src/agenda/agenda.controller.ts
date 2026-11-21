import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { sendDownload, UPLOAD_INTERCEPTOR } from "../parent-space/controllers";
import type { MulterFile } from "../parent-space/justifications.service";
import { MAX_UPLOAD_BYTES } from "../storage/storage.service";
import { AgendaRangeQueryDto, CreateAgendaItemDto, UpdateAgendaItemDto } from "./agenda.dto";
import { AgendaService } from "./agenda.service";

const UPLOAD_RATE_LIMIT = Number(process.env.UPLOAD_RATE_LIMIT ?? "20");

/** Bloc 3b : 3 pieces jointes maximum, 10 Mo chacune, multipart (multer, memoire). */
const AGENDA_FILES_INTERCEPTOR = FilesInterceptor("attachments", 3, {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 3, fields: 12, parts: 16 },
});

/** Côté école : direction (MFA vérifiée en service pour écrire) et enseignants affectés. */
@Controller("agenda")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction", "teacher")
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: AgendaRangeQueryDto) {
    return this.agenda.listForStaff(auth, query);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: UPLOAD_RATE_LIMIT, ttl: 60_000 } })
  @UseInterceptors(AGENDA_FILES_INTERCEPTOR)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateAgendaItemDto,
    @Req() request: Request,
    @UploadedFiles() files?: MulterFile[],
  ) {
    return this.agenda.create(auth, dto, clientInfo(request), files ?? []);
  }

  @Get(":id")
  detail(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.agenda.detail(auth, id);
  }

  @Patch(":id")
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgendaItemDto,
    @Req() request: Request,
  ) {
    return this.agenda.update(auth, id, dto, clientInfo(request));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.agenda.cancel(auth, id, clientInfo(request));
  }

  @Post(":id/attachments")
  @HttpCode(201)
  @Throttle({ default: { limit: UPLOAD_RATE_LIMIT, ttl: 60_000 } })
  @UseInterceptors(UPLOAD_INTERCEPTOR)
  attach(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Req() request: Request,
    @UploadedFile() file?: MulterFile,
  ) {
    return this.agenda.addAttachment(auth, id, file, clientInfo(request));
  }

  @Get(":id/attachments/:attachmentId/file")
  async file(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendDownload(response, await this.agenda.attachmentFile(auth, id, attachmentId));
  }
}

/** Côté parent : classes de ses enfants et dates d'école uniquement. */
@Controller("family/agenda")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("parent")
export class FamilyAgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Query() query: AgendaRangeQueryDto) {
    return this.agenda.listForParent(auth, query);
  }

  @Get(":id")
  detail(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.agenda.detail(auth, id);
  }

  @Get(":id/attachments/:attachmentId/file")
  async file(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return sendDownload(response, await this.agenda.attachmentFile(auth, id, attachmentId));
  }
}
