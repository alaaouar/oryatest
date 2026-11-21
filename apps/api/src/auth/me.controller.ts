import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { clientInfo } from "../common/client-info";
import { CurrentAuth } from "./decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "./guards";
import type { AuthContext } from "./auth.types";
import { AuthService } from "./auth.service";
import { ChangePasswordDto, SelectProfileDto } from "./dto";

/** t62u A1 : 5 changements de mot de passe par minute et par IP (surchargeable pour les tests). */
const PASSWORD_CHANGE_LIMIT = Number(process.env.PASSWORD_CHANGE_LIMIT ?? "5");

/** Espace personnel : profil actif et appareils connectés (CDC §3.3 et §3.4). */
@Controller("me")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth.userId, auth.profileId);
  }

  @Post("profiles/select")
  @HttpCode(200)
  select(@CurrentAuth() auth: AuthContext, @Body() dto: SelectProfileDto) {
    return this.auth.selectProfile(auth.userId, auth.deviceId, auth.mfa, dto);
  }

  /**
   * t62u A1 : changement de mot de passe. Mot de passe actuel exige, politique appliquee,
   * autres sessions revoquees (la session courante reste ouverte), audit critique.
   * Exemptee de la suspension d'ecole (prefixe /me, isSuspensionExempt) : la securite du
   * compte n'est jamais bloquee par la facturation.
   */
  @Post("password")
  @HttpCode(200)
  @Throttle({ default: { limit: PASSWORD_CHANGE_LIMIT, ttl: 60_000 } })
  changePassword(@CurrentAuth() auth: AuthContext, @Body() dto: ChangePasswordDto, @Req() request: Request) {
    return this.auth.changePassword(auth.userId, auth.deviceId, dto, clientInfo(request));
  }

  @Get("devices")
  devices(@CurrentAuth() auth: AuthContext) {
    return this.auth.listDevices(auth.userId, auth.deviceId);
  }

  @Delete("devices/:id")
  revoke(@CurrentAuth() auth: AuthContext, @Param("id") deviceId: string) {
    return this.auth.revokeDevice(auth.userId, auth.deviceId, deviceId);
  }
}
