import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { CreateAssessmentDto, ListAssessmentsQueryDto, SetScoresDto } from "./results.dto";
import { ResultsService } from "./results.service";

/** t92 (CDC M7) : saisie des résultats (enseignant de la classe, direction). */
@Controller("results")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction", "teacher")
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get("assessments")
  list(@CurrentAuth() auth: AuthContext, @Query() query: ListAssessmentsQueryDto) {
    return this.results.list(auth, query.classroomId);
  }

  @Post("assessments")
  @HttpCode(201)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateAssessmentDto, @Req() request: Request) {
    return this.results.create(auth, dto, clientInfo(request));
  }

  @Get("assessments/:id")
  get(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.results.get(auth, id);
  }

  @Put("assessments/:id/scores")
  setScores(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetScoresDto,
    @Req() request: Request,
  ) {
    return this.results.setScores(auth, id, dto, clientInfo(request));
  }

  @Post("assessments/:id/publish")
  @HttpCode(200)
  publish(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.results.publish(auth, id, clientInfo(request));
  }

  @Delete("assessments/:id")
  @HttpCode(200)
  delete(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.results.delete(auth, id, clientInfo(request));
  }
}

/** t92 (CDC M7) : résultats publiés d'un enfant, côté parent. */
@Controller("family/children/:studentId/results")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("parent")
export class FamilyResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext, @Param("studentId", ParseUUIDPipe) studentId: string) {
    return this.results.forParent(auth, studentId);
  }
}
