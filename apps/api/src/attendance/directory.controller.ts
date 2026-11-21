import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { SchoolYearQueryDto } from "./attendance.dto";
import { DirectoryService } from "./directory.service";

@Controller("classrooms")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class ClassroomsController {
  constructor(private readonly directory: DirectoryService) {}

  /** Direction : toutes les classes. Enseignant : ses classes affectées. */
  @Get()
  @Roles("direction", "teacher", "super_admin")
  list(@CurrentAuth() auth: AuthContext, @Query() query: SchoolYearQueryDto) {
    return this.directory.listClassrooms(auth, query.schoolYear);
  }
}

@Controller("teachers")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class TeachersController {
  constructor(private readonly directory: DirectoryService) {}

  @Get()
  @Roles("direction", "super_admin")
  list(@CurrentAuth() auth: AuthContext) {
    return this.directory.listTeachers(auth);
  }
}