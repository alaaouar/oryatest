import {
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from "@nestjs/common";
import type { AuthContext, Role } from "./auth.types";

/** Rôles autorisés sur une route (CDC §3.5). */
export const ROLES_KEY = "orya:roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Exige une session ayant franchi le second facteur (CDC §3.4). */
export const REQUIRE_MFA_KEY = "orya:require-mfa";
export const RequireMfa = () => SetMetadata(REQUIRE_MFA_KEY, true);

/** Injecte le contexte d'authentification validé par JwtAuthGuard. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
    if (!request.auth) {
      throw new Error("CurrentAuth utilisé sans JwtAuthGuard.");
    }
    return request.auth;
  },
);
