import { Body, Controller, ForbiddenException, Get, Header, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, csrfCookie, csrfMatches, newCsrfToken, parseCookies, REFRESH_COOKIE, WEB_CLIENT_HEADER } from "./cookie-session";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { clientInfo } from "../common/client-info";
import { CurrentAuth } from "./decorators";
import { JwtAuthGuard } from "./guards";
import type { AuthContext } from "./auth.types";
import { AuthService } from "./auth.service";
import { LoginDto, MfaChallengeDto, MfaVerifyDto, RefreshDto } from "./dto";

/** 5 tentatives par minute et par IP par défaut, surchargeable pour les tests. */
const LOGIN_RATE_LIMIT = Number(process.env.AUTH_LOGIN_LIMIT ?? "5");

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** CDC §8 S-7 : limitation de débit sur les opérations sensibles. */
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: LOGIN_RATE_LIMIT, ttl: 60_000 } })
  login(@Body() dto: LoginDto, @Req() request: Request) {
    return this.auth.login(dto, clientInfo(request));
  }

  @Post("mfa/enroll")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  enroll(@Body() dto: MfaChallengeDto, @Req() request: Request) {
    return this.auth.enrollMfa(dto.challengeToken, clientInfo(request));
  }

  @Post("mfa/verify")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@Body() dto: MfaVerifyDto, @Req() request: Request) {
    return this.auth.verifyMfa(dto, clientInfo(request));
  }

  @Post("refresh")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  refresh(@Body() dto: RefreshDto, @Req() request: Request) {
    let token = dto.refreshToken;
    if (!token) {
      // Lot 10 : client web, jeton en cookie httpOnly ; CSRF exigé (double soumission).
      const cookies = parseCookies(request.headers.cookie);
      if (!csrfMatches(request.headers[CSRF_HEADER], cookies[CSRF_COOKIE])) {
        throw new ForbiddenException("Jeton CSRF absent ou invalide.");
      }
      token = cookies[REFRESH_COOKIE];
    }
    if (!token) {
      throw new UnauthorizedException("Session expirée.");
    }
    return this.auth.refresh(token, clientInfo(request));
  }

  /**
   * B07 : reprise du jeton CSRF d'une session navigateur DEJA authentifiee (cookie httpOnly
   * orya_at valide et session active, verifies par JwtAuthGuard) quand l'onglet l'a perdu :
   * nouvel onglet, navigation avant la fin de mfa/verify, sessionStorage vide.
   * - GET sans effet de bord sur la session : aucun jeton d'acces/refresh emis ni tourne ;
   * - renvoie la valeur du cookie orya_csrf existant (pas de rotation : les autres onglets
   *   gardent un jeton valide), ou en pose un neuf s'il manque ;
   * - la double soumission reste exigee sur toutes les ecritures : un site tiers ne peut ni
   *   envoyer les cookies (SameSite=Strict) ni lire la reponse (CORS limite aux origines
   *   explicites) ; un client Bearer n'a pas de session cookie -> 401.
   */
  @Get("csrf")
  @UseGuards(JwtAuthGuard)
  @Header("Cache-Control", "no-store")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const cookies = parseCookies(request.headers.cookie);
    if (request.headers[WEB_CLIENT_HEADER] !== "web" || !cookies[ACCESS_COOKIE]) {
      throw new UnauthorizedException("Session navigateur absente.");
    }
    const existing = cookies[CSRF_COOKIE];
    if (existing && existing.length >= 32) {
      return { csrfToken: existing };
    }
    const csrfToken = newCsrfToken();
    response.append("Set-Cookie", csrfCookie(csrfToken));
    return { csrfToken };
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logout(@CurrentAuth() auth: AuthContext, @Req() request: Request) {
    return this.auth.logout(auth.userId, auth.deviceId, clientInfo(request));
  }
}
