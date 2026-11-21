import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { AccountDeletionService } from "./account-deletion.service";
import { RequestDeletionDto, RequestStudentDeletionDto } from "./account-deletion.dto";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class AccountDeletionController {
  constructor(private readonly deletions: AccountDeletionService) {}

  @Post("me/deletion")
  @Roles("parent", "teacher", "direction", "bus_attendant", "chauffeur", "super_admin")
  @HttpCode(202)
  requestSelf(@CurrentAuth() auth: AuthContext, @Body() dto: RequestDeletionDto, @Req() request: Request) {
    return this.deletions.requestSelfDeletion(auth, dto.password, dto.mfaCode, clientInfo(request));
  }

  @Delete("me/deletion")
  @Roles("parent", "teacher", "direction", "bus_attendant", "chauffeur", "super_admin")
  @HttpCode(200)
  cancel(@CurrentAuth() auth: AuthContext, @Req() request: Request) {
    return this.deletions.cancel(auth, clientInfo(request));
  }

  @Get("me/deletion")
  @Roles("parent", "teacher", "direction", "bus_attendant", "chauffeur", "super_admin", "student")
  status(@CurrentAuth() auth: AuthContext) {
    return this.deletions.status(auth);
  }

  @Post("students/deletion")
  @Roles("parent", "direction", "super_admin")
  @HttpCode(202)
  requestStudent(@CurrentAuth() auth: AuthContext, @Body() dto: RequestStudentDeletionDto, @Req() request: Request) {
    return this.deletions.requestStudentDeletion(auth, dto.studentId, dto.password, dto.mfaCode, clientInfo(request));
  }
}
