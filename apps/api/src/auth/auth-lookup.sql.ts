/**
 * P0-3 : seul acces aux colonnes d'authentification de "User".
 *
 * orya_app n'a plus SELECT sur passwordHash, mfaSecret, mfaLastStep, failedLoginCount
 * ni lockedUntil. Ces valeurs ne sont lues qu'au travers de deux fonctions SECURITY
 * DEFINER (prisma/sql/010_rls.sql, section 7) qui renvoient TOUJOURS une ligne
 * (found = false si le compte est inconnu) et jamais plus d'un compte.
 *
 * Fichier autorise au SQL brut dans test/static/check-tenancy.mjs : requetes
 * parametrees uniquement ($queryRaw en gabarit, jamais Unsafe).
 */
import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../core/prisma.service";

type QueryClient = PrismaService | Prisma.TransactionClient;

export type CredentialsRow = {
  found: boolean;
  user_id: string | null;
  password_hash: string | null;
  status: string | null;
  mfa_enrolled: boolean | null;
  failed_login_count: number | null;
  locked_until: Date | null;
  active_profile_id: string | null;
};

export type MfaStateRow = {
  found: boolean;
  status: string | null;
  mfa_secret: string | null;
  mfa_enrolled_at: Date | null;
  mfa_last_step: number | null;
  active_profile_id: string | null;
};

export async function readCredentials(prisma: QueryClient, email: string): Promise<CredentialsRow | undefined> {
  const rows = await prisma.$queryRaw<CredentialsRow[]>`SELECT * FROM orya_auth_credentials(${email})`;
  return rows[0];
}

export async function readMfaState(prisma: QueryClient, userId: string): Promise<MfaStateRow | undefined> {
  const rows = await prisma.$queryRaw<MfaStateRow[]>`SELECT * FROM orya_auth_mfa_state(${userId}::uuid)`;
  return rows[0];
}
