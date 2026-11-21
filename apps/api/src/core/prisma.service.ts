import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";

/**
 * Client Prisma de l'API.
 *
 * Se connecte avec DATABASE_URL, c'est-à-dire le rôle `orya_app` soumis au RLS.
 * Ne JAMAIS utiliser DIRECT_DATABASE_URL ici : cela contournerait toute
 * l'isolation multi-écoles (voir ADR-002).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({
      datasourceUrl: config.get<string>("DATABASE_URL"),
      log: ["warn", "error"],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Connexion PostgreSQL établie (rôle applicatif, RLS actif).");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
