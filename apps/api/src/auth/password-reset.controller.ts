import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { clientInfo } from "../common/client-info";
import { PasswordForgotDto, PasswordResetDto } from "./dto";
import { PasswordResetService } from "./password-reset.service";

/** Plafonds par IP (minute), surchargeables pour les tests uniquement. */
const FORGOT_IP_LIMIT = Number(process.env.PASSWORD_RESET_IP_LIMIT ?? "5");
const RESET_IP_LIMIT = Number(process.env.PASSWORD_RESET_CONFIRM_IP_LIMIT ?? "10");

/** F01 (t87u) : routes publiques de reinitialisation (aucune session, aucun cookie emis). */
@Controller("auth/password")
export class PasswordResetController {
  constructor(private readonly reset: PasswordResetService) {}

  @Post("forgot")
  @HttpCode(202)
  @Throttle({ default: { limit: FORGOT_IP_LIMIT, ttl: 60_000 } })
  forgot(@Body() dto: PasswordForgotDto, @Req() request: Request) {
    return this.reset.request(dto.email, clientInfo(request));
  }

  @Post("reset")
  @HttpCode(200)
  @Throttle({ default: { limit: RESET_IP_LIMIT, ttl: 60_000 } })
  confirm(@Body() dto: PasswordResetDto, @Req() request: Request) {
    return this.reset.confirm(dto.token, dto.newPassword, clientInfo(request));
  }
}