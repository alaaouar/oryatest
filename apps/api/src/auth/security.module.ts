import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "./guards";
import { TokenService } from "./token.service";

/**
 * Briques de sécurité partagées par tous les modules.
 *
 * Global pour éviter que chaque module métier ait à réimporter les gardes.
 * JwtModule est enregistré sans secret global : TokenService fournit
 * explicitement le secret à chaque signature (un seul endroit à auditer).
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [TokenService, JwtAuthGuard, RolesGuard, MfaGuard],
  exports: [TokenService, JwtAuthGuard, RolesGuard, MfaGuard],
})
export class SecurityModule {}
