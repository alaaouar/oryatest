import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { clientInfo } from "../common/client-info";
import { ActivationService } from "./activation.service";
import { AcceptInvitationDto, ActivateParentDto } from "./activation.dto";

/**
 * Limite de débit par IP (fusionnée avec le verrouillage applicatif d'
 * AttemptThrottleService). Surchargeable pour les tests : ACTIVATION_RATE_LIMIT.
 */
const ACTIVATION_RATE_LIMIT = Number(process.env.ACTIVATION_RATE_LIMIT ?? 10);

/**
 * Activation publique (CDC §3.2).
 * Aucun jeton n'est requis : c'est le code établissement + code d'activation,
 * ou l'invitation, qui prouvent le rattachement. Toute tentative échouée est
 * comptée et auditée.
 */
@Controller("activation")
export class ActivationController {
  constructor(private readonly activation: ActivationService) {}

  @Post("parent")
  @HttpCode(201)
  @Throttle({ default: { limit: ACTIVATION_RATE_LIMIT, ttl: 60_000 } })
  parent(@Body() dto: ActivateParentDto, @Req() request: Request) {
    const info = clientInfo(request);
    return this.activation.activateParent(dto, info, `parent:${info.ip ?? "unknown"}`);
  }

  @Post("invitation")
  @HttpCode(200)
  @Throttle({ default: { limit: ACTIVATION_RATE_LIMIT, ttl: 60_000 } })
  invitation(@Body() dto: AcceptInvitationDto, @Req() request: Request) {
    const info = clientInfo(request);
    return this.activation.acceptInvitation(dto, info, `invitation:${info.ip ?? "unknown"}`);
  }
}
