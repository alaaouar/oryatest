import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { TenancyService } from "./tenancy.service";

/**
 * Services transverses : accès base (rôle applicatif soumis au RLS) et contexte
 * d'école. Exportés globalement pour éviter les imports circulaires.
 */
@Global()
@Module({
  providers: [PrismaService, TenancyService],
  exports: [PrismaService, TenancyService],
})
export class CoreModule {}
