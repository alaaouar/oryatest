import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { BusDateQueryDto, SetBusStatusDto } from "./bus.dto";
import { BusService } from "./bus.service";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class BusController {
  constructor(private readonly bus: BusService) {}

  @Post("bus/status")
  @Roles("bus_attendant", "direction")
  @HttpCode(200)
  set(@CurrentAuth() auth: AuthContext, @Body() dto: SetBusStatusDto, @Req() request: Request) {
    return this.bus.setStatus(auth, dto, clientInfo(request));
  }

  @Get("bus/status")
  @Roles("bus_attendant", "direction")
  list(@CurrentAuth() auth: AuthContext, @Query() query: BusDateQueryDto) {
    return this.bus.listForDate(auth, query.date);
  }

  @Get("family/children/:studentId/bus")
  @Roles("parent")
  child(@CurrentAuth() auth: AuthContext, @Param("studentId", ParseUUIDPipe) studentId: string) {
    return this.bus.forParent(auth, studentId);
  }
}