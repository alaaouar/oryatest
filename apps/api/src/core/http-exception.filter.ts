import {
  ArgumentsHost,
  Catch,
  HttpException,
  Logger,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Filtre global d'erreurs.
 *
 * Objectif : ne jamais renvoyer au client un message interne (erreur Prisma,
 * nom de table, chaîne de connexion, pile d'appels). Les détails restent dans
 * les journaux du serveur, la réponse reste générique.
 *
 * Répond au constat P1 de l'audit : `actions.ts` renvoyait `error.message`
 * tel quel au navigateur.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("HTTP");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      const body =
        typeof payload === "string"
          ? { message: payload }
          : (payload as Record<string, unknown>);

      response.status(status).json({
        ...body,
        statusCode: status,
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Express / raw-body : corps trop volumineux avant d'atteindre le handler.
    if (isPayloadTooLarge(exception)) {
      response.status(413).json({
        statusCode: 413,
        message: "Corps de requête trop volumineux.",
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    this.logger.error(
      `Erreur non gérée sur ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(500).json({
      statusCode: 500,
      message: "Une erreur interne est survenue. Aucun détail technique n'est exposé.",
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}

function isPayloadTooLarge(exception: unknown): boolean {
  if (!exception || typeof exception !== "object") {
    return false;
  }

  const error = exception as {
    type?: string;
    status?: number;
    statusCode?: number;
    name?: string;
  };

  return (
    error.type === "entity.too.large" ||
    error.status === 413 ||
    error.statusCode === 413 ||
    error.name === "PayloadTooLargeError"
  );
}
