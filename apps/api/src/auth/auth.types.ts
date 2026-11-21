import type { ProfileRole } from "@prisma/client";
import type { TenantContext } from "../core/tenancy.service";

/** Rôles du CDC §3.1. Alias local pour éviter d'importer Prisma partout. */
export type Role = ProfileRole;

/** Rôles qui exigent une authentification renforcée (CDC §3.4). */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(["direction", "super_admin"]);

/** Contexte attaché à la requête après validation du jeton d'accès. */
export type AuthContext = {
  userId: string;
  profileId: string;
  deviceId: string;
  schoolId: string | null;
  role: Role;
  mfa: boolean;
};

/** Contenu du jeton d'accès (JWT signé, 15 minutes par défaut). */
export type AccessTokenPayload = {
  sub: string; // userId
  pid: string; // profileId actif
  sid: string; // deviceId (permet la révocation)
  sch: string | null; // schoolId
  rol: Role;
  mfa: boolean;
  typ: "access";
};

/** Jeton de défi, émis entre le mot de passe et le second facteur. */
export type ChallengePayload = {
  sub: string; // userId
  typ: "mfa";
  mth: "enroll" | "verify";
};

/** Charge utile minimale d'un profil, telle qu'exposée aux clients. */
export type PublicProfile = {
  id: string;
  role: Role;
  schoolId: string | null;
  schoolName: string | null;
  schoolStatus: "pending" | "active" | "suspended" | null;
  displayName: string;
};

/**
 * Convertit le contexte de requête en contexte de base de données.
 * Le schoolId vient toujours du jeton, jamais du client.
 */
export function toTenantContext(auth: AuthContext): TenantContext {
  return {
    userId: auth.userId,
    profileId: auth.profileId,
    schoolId: auth.schoolId,
    isSuperAdmin: auth.role === "super_admin",
  };
}
