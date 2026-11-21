import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { CreateAssignmentDto } from "./attendance.dto";
import { AssignmentsService } from "./assignments.service";

@Controller("assignments")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Get()
  @Roles("direction", "teacher", "super_admin")
  async list(@CurrentAuth() auth: AuthContext) {
    return { assignments: await this.assignments.list(auth) };
  }

  @Post()
  @HttpCode(201)
  @Roles("direction", "super_admin")
  @RequireMfa()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateAssignmentDto,
    @Req() request: Request,
  ) {
    return this.assignments.create(auth, dto, clientInfo(request));
  }

  @Delete(":id")
  @HttpCode(200)
  @Roles("direction", "super_admin")
  @RequireMfa()
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param("id") assignmentId: string,
    @Req() request: Request,
  ) {
    return this.assignments.remove(auth, assignmentId, clientInfo(request));
  }
}
