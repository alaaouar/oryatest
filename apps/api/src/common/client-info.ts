import type { Request } from "express";
import type { ClientInfo } from "../auth/auth.service";

/** Informations client journalisées avec l'audit, jamais utilisées pour autoriser. */
export function clientInfo(request: Request): ClientInfo {
  const agent = request.headers["user-agent"];

  return {
    ip: request.ip ?? null,
    userAgent: typeof agent === "string" ? agent.slice(0, 300) : null,
  };
}
