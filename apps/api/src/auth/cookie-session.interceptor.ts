import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { map, type Observable } from "rxjs";
import { clearedCookies, newCsrfToken, sessionCookies, WEB_CLIENT_HEADER } from "./cookie-session";

/**
 * Lot 10 : pour le client web (en-tête X-Orya-Client: web), toute réponse qui
 * émet des jetons (connexion, MFA, rafraîchissement, changement de profil,
 * activation) les pose en cookies httpOnly et les RETIRE du corps : le
 * JavaScript de la page n'y a jamais accès. La déconnexion efface les cookies.
 */
@Injectable()
export class CookieSessionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    if (request.headers[WEB_CLIENT_HEADER] !== "web") return next.handle();
    const logout = /\/auth\/logout$/.test(request.path);
    return next.handle().pipe(
      map((body: unknown) => {
        if (logout) {
          response.append("Set-Cookie", clearedCookies());
          return body;
        }
        if (body && typeof body === "object" && typeof (body as { accessToken?: unknown }).accessToken === "string") {
          const { accessToken, refreshToken, ...rest } = body as { accessToken: string; refreshToken?: string } & Record<string, unknown>;
          const csrfToken = newCsrfToken();
          response.append("Set-Cookie", sessionCookies({ accessToken, refreshToken }, csrfToken));
          return { ...rest, cookieSession: true, csrfToken };
        }
        return body;
      }),
    );
  }
}
