import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { FamilyService } from "./family.service";

/** Espace parent (socle Lot 3) : uniquement les enfants rattachés au compte. */
@Controller("family")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("parent")
export class FamilyController {
  constructor(private readonly family: FamilyService) {}

  @Get("children")
  async children(@CurrentAuth() auth: AuthContext) {
    return { children: await this.family.children(auth) };
  }

  @Get("children/:id")
  child(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.family.child(auth, id);
  }
}
