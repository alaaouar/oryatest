import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, RequireMfa, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { CreateCircuitDto, CreateStopDto, RoadmapQueryDto, SetCircuitStudentsDto, UpdateCircuitDto } from "./circuits.dto";
import { CircuitsService } from "./circuits.service";

/** t92 (CDC 3.2 / 3.5 / 5) : circuits. Lecture : direction et accompagnateur (ses circuits) ; gestion : direction (MFA). */
@Controller("bus")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction", "bus_attendant")
export class CircuitsController {
  constructor(private readonly circuits: CircuitsService) {}

  @Get("circuits")
  list(@CurrentAuth() auth: AuthContext) {
    return this.circuits.list(auth);
  }

  @Get("attendants")
  @Roles("direction")
  attendants(@CurrentAuth() auth: AuthContext) {
    return this.circuits.attendants(auth);
  }

  @Post("circuits")
  @Roles("direction")
  @RequireMfa()
  @HttpCode(201)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateCircuitDto, @Req() request: Request) {
    return this.circuits.create(auth, dto, clientInfo(request));
  }

  @Patch("circuits/:id")
  @Roles("direction")
  @RequireMfa()
  update(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCircuitDto, @Req() request: Request) {
    return this.circuits.update(auth, id, dto, clientInfo(request));
  }

  @Post("circuits/:id/stops")
  @Roles("direction")
  @RequireMfa()
  @HttpCode(201)
  addStop(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: CreateStopDto, @Req() request: Request) {
    return this.circuits.addStop(auth, id, dto, clientInfo(request));
  }

  @Put("circuits/:id/students")
  @Roles("direction")
  @RequireMfa()
  setStudents(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body() dto: SetCircuitStudentsDto, @Req() request: Request) {
    return this.circuits.setStudents(auth, id, dto, clientInfo(request));
  }

  @Get("circuits/:id/roadmap")
  roadmap(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Query() query: RoadmapQueryDto) {
    return this.circuits.roadmap(auth, id, query.date);
  }
}
