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
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { IssueActivationCodeDto } from "../activation/activation.dto";
import { clientInfo } from "../common/client-info";
import { ChangeClassDto, ListStudentsQueryDto, UpdateStudentDto } from "./students.dto";
import { StudentsService } from "./students.service";

/** Élèves : liste, fiche, mise à jour, changement de classe, codes parent. */
@Controller("students")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction", "teacher", "super_admin")
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query() query: ListStudentsQueryDto) {
    return { students: await this.students.list(auth, query) };
  }

  @Get(":id/profile")
  detail(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) studentId: string) {
    return this.students.detail(auth, studentId);
  }

  @Get(":id")
  get(@CurrentAuth() auth: AuthContext, @Param("id") studentId: string) {
    return this.students.get(auth, studentId);
  }

  @Patch(":id")
  @Roles("direction", "super_admin")
  @RequireMfa()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) studentId: string,
    @Body() dto: UpdateStudentDto,
    @Req() request: Request,
  ) {
    return this.students.update(auth, studentId, dto, clientInfo(request));
  }

  @Post(":id/enrollment")
  @HttpCode(200)
  @Roles("direction", "super_admin")
  @RequireMfa()
  changeClass(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) studentId: string,
    @Body() dto: ChangeClassDto,
    @Req() request: Request,
  ) {
    return this.students.changeClass(auth, studentId, dto, clientInfo(request));
  }

  /**
   * Réservé à la direction : un enseignant ne doit pas pouvoir générer un code
   * d'accès aux données d'un élève.
   */
  @Post(":id/activation-code")
  @HttpCode(201)
  @Roles("direction", "super_admin")
  @RequireMfa()
  issueActivationCode(
    @CurrentAuth() auth: AuthContext,
    @Param("id") studentId: string,
    @Body() dto: IssueActivationCodeDto,
  ) {
    return this.students.issueActivationCode(auth, studentId, dto.ttlDays);
  }
}
