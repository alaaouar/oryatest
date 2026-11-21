import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";

/**
 * Contexte de sécurité d'une requête. Il provient EXCLUSIVEMENT du jeton de
 * session (profil actif), jamais d'un paramètre d'URL ou d'un corps de requête.
 */
export type TenantContext = {
  userId: string;
  profileId: string;
  schoolId: string | null;
  isSuperAdmin: boolean;
};

const TRANSACTION_TIMEOUT_MS = 15_000;

/**
 * Point d'entrée unique de toutes les requêtes métier.
 *
 * Ouvre une transaction, y pose les variables lues par les policies RLS, puis
 * exécute le travail. Les variables sont posées avec set_config(..., true), donc
 * locales à la transaction : elles ne peuvent pas fuir d'une requête à l'autre à
 * travers le pool de connexions (voir ADR-002).
 */
@Injectable()
export class TenancyService {
  private readonly logger = new Logger(TenancyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Contexte « métier » : l'utilisateur agit dans une école (ou en super-admin).
   * C'est le seul contexte autorisé pour lire ou écrire des données scolaires.
   */
  async run<T>(
    context: TenantContext,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    this.assertContext(context);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${context.userId}, true)`;
        await tx.$queryRaw`SELECT set_config('app.school_id', ${context.schoolId ?? ""}, true)`;
        await tx.$queryRaw`SELECT set_config('app.is_super_admin', ${
          context.isSuperAdmin ? "on" : "off"
        }, true)`;

        return work(tx);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  /**
   * Contexte « identité » : utilisé avant qu'une session d'école existe
   * (connexion, rotation de jeton, liste des appareils, profil actif).
   *
   * Aucune école n'est posée : les policies qui exigent un schoolId renvoient
   * donc zéro ligne. Seules les tables d'identité autorisant l'utilisateur
   * lui-même sont accessibles (UserProfile, Device, Consent, AuditLog personnel).
   */
  async runIdentity<T>(
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!userId) {
      throw new ForbiddenException("Session invalide.");
    }

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
        await tx.$queryRaw`SELECT set_config('app.school_id', '', true)`;
        await tx.$queryRaw`SELECT set_config('app.is_super_admin', 'off', true)`;

        return work(tx);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  /**
   * Contexte « établissement » : utilisé pendant l'activation, avant qu'un compte
   * n'existe (recherche de l'élève par son code, comptage des responsables).
   * Aucun utilisateur n'est posé : les policies exigeant app.user_id refusent tout.
   */
  async runSchool<T>(
    schoolId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!schoolId) {
      throw new ForbiddenException("Établissement manquant.");
    }

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', '', true)`;
        await tx.$queryRaw`SELECT set_config('app.school_id', ${schoolId}, true)`;
        await tx.$queryRaw`SELECT set_config('app.is_super_admin', 'off', true)`;

        return work(tx);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  /**
   * Contexte d'onboarding : un compte vient d'être créé et rattache son profil et
   * son responsable à une école. Le schoolId est celui de l'école prouvée par le
   * code ou l'invitation, jamais celui fourni par le client.
   */
  async runOnboarding<T>(
    userId: string,
    schoolId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!userId || !schoolId) {
      throw new ForbiddenException("Contexte d'activation incomplet.");
    }

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
        await tx.$queryRaw`SELECT set_config('app.school_id', ${schoolId}, true)`;
        await tx.$queryRaw`SELECT set_config('app.is_super_admin', 'off', true)`;

        return work(tx);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  /**
   * Recherche d'une école par son code public à 6 caractères, avant toute session.
   * La policy RLS n'autorise que la ligne dont le code correspond exactement.
   */
  async runSchoolCode<T>(
    code: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', '', true)`;
        await tx.$queryRaw`SELECT set_config('app.school_id', '', true)`;
        await tx.$queryRaw`SELECT set_config('app.school_code', ${code}, true)`;
        await tx.$queryRaw`SELECT set_config('app.is_super_admin', 'off', true)`;

        return work(tx);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }


  /**
   * Contexte systeme (jobs ops, rejeu du registre) : aucune session utilisateur,
   * is_super_admin=on. Cross-tenant volontaire ; reserve aux taches planifiees
   * et aux outils d'exploitation, jamais aux routes HTTP metier.
   */
  async runSystem<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', '', true)`;
        await tx.$queryRaw`SELECT set_config('app.school_id', '', true)`;
        await tx.$queryRaw`SELECT set_config('app.is_super_admin', 'on', true)`;
        return work(tx);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }

  /**
   * Contexte public (lecture de textes de consentement valides, etc.) :
   * aucune session, is_super_admin=off. Les policies SELECT USING (true)
   * restent accessibles ; le reste est refuse par RLS.
   */
  async runPublic<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', '', true)`;
        await tx.$queryRaw`SELECT set_config('app.school_id', '', true)`;
        await tx.$queryRaw`SELECT set_config('app.is_super_admin', 'off', true)`;
        return work(tx);
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  }
  /**
   * Vérifie qu'une ressource appartient bien à l'école du contexte avant toute
   * réponse. Un identifiant hors école doit produire un 404, jamais un 403 :
   * un 403 confirmerait l'existence de la ressource à un tiers.
   */
  assertSchoolScope(context: TenantContext, schoolId: string | null): void {
    if (context.isSuperAdmin) {
      return;
    }
    if (!context.schoolId || !schoolId || context.schoolId !== schoolId) {
      throw new ForbiddenException("Ressource hors de votre établissement.");
    }
  }

  private assertContext(context: TenantContext): void {
    if (!context.userId || !context.profileId) {
      throw new ForbiddenException("Contexte de session incomplet.");
    }
    if (context.isSuperAdmin && context.schoolId !== null) {
      throw new ForbiddenException(
        "Contexte incohérent : un super-admin n'est rattaché à aucune école.",
      );
    }
    if (!context.isSuperAdmin && !context.schoolId) {
      this.logger.warn(
        `Profil ${context.profileId} sans école alors qu'il n'est pas super-admin.`,
      );
      throw new ForbiddenException("Aucun établissement actif dans la session.");
    }
  }
}
