import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { clientInfo } from "../common/client-info";
import { ListFamilyMessagesQueryDto, ReplyDto, SendMessageDto } from "./communication.dto";
import { CommunicationService } from "./communication.service";

/** Côté école : direction (MFA vérifiée en service pour l'envoi) et enseignants. */
@Controller("messages")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("direction", "teacher")
export class MessagesController {
  constructor(private readonly communication: CommunicationService) {}

  @Get("channels")
  channels() {
    return this.communication.channels();
  }

  @Get()
  async list(@CurrentAuth() auth: AuthContext) {
    return { messages: await this.communication.listSent(auth) };
  }

  @Post()
  @HttpCode(201)
  send(@CurrentAuth() auth: AuthContext, @Body() dto: SendMessageDto, @Req() request: Request) {
    return this.communication.send(auth, dto, clientInfo(request));
  }

  @Get(":id")
  detail(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.communication.detailForStaff(auth, id);
  }

  @Post(":id/replies")
  @HttpCode(201)
  reply(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
    @Req() request: Request,
  ) {
    return this.communication.replyAsStaff(auth, id, dto, clientInfo(request));
  }
}

/** Côté parent : messages reçus uniquement. */
@Controller("family/messages")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
@Roles("parent")
export class FamilyMessagesController {
  constructor(private readonly communication: CommunicationService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext, @Query() query: ListFamilyMessagesQueryDto) {
    return { messages: await this.communication.listForParent(auth, query) };
  }

  @Get(":id")
  open(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.communication.openForParent(auth, id);
  }

  @Post(":id/ack")
  @HttpCode(200)
  ack(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.communication.acknowledge(auth, id, clientInfo(request));
  }

  @Post(":id/replies")
  @HttpCode(201)
  reply(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
    @Req() request: Request,
  ) {
    return this.communication.replyAsParent(auth, id, dto, clientInfo(request));
  }
}
