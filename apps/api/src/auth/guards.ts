import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRE_MFA_KEY, ROLES_KEY } from "./decorators";
import type { AuthContext, Role } from "./auth.types";
import { TokenService } from "./token.service";
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, csrfMatches, isSafeMethod, parseCookies } from "./cookie-session";

type RequestWithAuth = {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  auth?: AuthContext;
};

/** Valide le jeton d'accès et attache le contexte à la requête. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const header = request.headers.authorization;
    let token: string | null = null;

    if (typeof header === "string" && header.startsWith("Bearer ")) {
      token = header.slice("Bearer ".length).trim();
    } else {
      // Lot 10 : session navigateur (cookie httpOnly) + contrôle CSRF sur les écritures.
      const cookies = parseCookies(request.headers.cookie);
      token = cookies[ACCESS_COOKIE] ?? null;
      if (token && !isSafeMethod(request.method) && !csrfMatches(request.headers[CSRF_HEADER], cookies[CSRF_COOKIE])) {
        throw new ForbiddenException("Jeton CSRF absent ou invalide.");
      }
    }

    if (!token) {
      throw new UnauthorizedException("Jeton d'accès absent.");
    }

    const payload = await this.tokens.verifyAccess(token);
    // Lot 10 : révocation immédiate (logout, appareil révoqué, réutilisation de refresh).
    await this.tokens.assertSessionActive(payload.sub, payload.sid);

    request.auth = {
      userId: payload.sub,
      profileId: payload.pid,
      deviceId: payload.sid,
      schoolId: payload.sch,
      role: payload.rol,
      mfa: payload.mfa,
    };

    return true;
  }
}

/** Vérifie que le rôle du profil actif fait partie des rôles autorisés. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const role = request.auth?.role;

    if (!role || !required.includes(role)) {
      throw new ForbiddenException("Votre rôle ne permet pas cette action.");
    }

    return true;
  }
}

/**
 * Défense en profondeur : même si un jeton était émis sans second facteur,
 * une route marquée @RequireMfa() le refuse.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_MFA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    if (!request.auth?.mfa) {
      throw new ForbiddenException("Authentification renforcée requise pour cette action.");
    }

    return true;
  }
}
