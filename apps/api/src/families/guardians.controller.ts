import {
  Body,
  Controller,
  Delete,
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
import { clientInfo } from "../common/client-info";
import { GuardianInputDto, LinkStudentDto, ListGuardiansQueryDto, UpdateGuardianDto } from "./families.dto";
import { GuardiansService } from "./guardians.service";

/** Responsables légaux : direction uniquement (données personnelles des familles). */
@Controller("guardians")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction", "super_admin")
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query() query: ListGuardiansQueryDto) {
    return { guardians: await this.guardians.list(auth, query.search) };
  }

  @Get(":id")
  get(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.guardians.get(auth, id);
  }

  @Post()
  @HttpCode(201)
  @RequireMfa()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: GuardianInputDto, @Req() request: Request) {
    return this.guardians.create(auth, dto, clientInfo(request));
  }

  @Patch(":id")
  @RequireMfa()
  update(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateGuardianDto,
    @Req() request: Request,
  ) {
    return this.guardians.update(auth, id, dto, clientInfo(request));
  }

  @Post(":id/students")
  @HttpCode(201)
  @RequireMfa()
  link(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: LinkStudentDto,
    @Req() request: Request,
  ) {
    return this.guardians.link(auth, id, dto, clientInfo(request));
  }

  @Delete(":id/students/:studentId")
  @RequireMfa()
  unlink(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Req() request: Request,
  ) {
    return this.guardians.unlink(auth, id, studentId, clientInfo(request));
  }

  @Post(":id/invitation")
  @HttpCode(201)
  @RequireMfa()
  invite(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.guardians.invite(auth, id, clientInfo(request));
  }
}
