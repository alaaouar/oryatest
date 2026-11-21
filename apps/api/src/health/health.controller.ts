import { Controller, Get } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "../core/prisma.service";

/**
 * Sonde de disponibilité. Ne révèle aucune donnée métier ni aucun détail
 * d'infrastructure : uniquement un état et la version de l'API.
 * t62u B4 : etat des migrations (nombre appliquees, nombre en cours ou echouees, empreinte
 * md5 tronquee des noms) via orya_migrations_state() (SECURITY DEFINER, agregats seulement),
 * compare par scripts/preprod-smoke.ps1 aux migrations du commit deploye.
 */
// P0-4 : la sonde de sante (orchestrateur, proxy) ne consomme pas la limite de debit.
@SkipThrottle()
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{
    status: "ok";
    service: "orya-api";
    apiVersion: "v1";
    database: "ok";
    migrations: { applied: number; pending: number; digest: string } | "inconnu";
    timestamp: string;
  }> {
    await this.prisma.$queryRaw`SELECT 1`;

    let migrations: { applied: number; pending: number; digest: string } | "inconnu" = "inconnu";
    try {
      const rows = await this.prisma.$queryRaw<{ applied: number; pending: number; digest: string }[]>`SELECT applied, pending, digest FROM public.orya_migrations_state()`;
      const r = rows[0];
      if (r) migrations = { applied: Number(r.applied), pending: Number(r.pending), digest: String(r.digest).slice(0, 12) };
    } catch {
      // Fonction absente (base anterieure a 010_rls.sql t62u) : la sonde reste disponible.
    }

    return {
      status: "ok",
      service: "orya-api",
      apiVersion: "v1",
      database: "ok",
      migrations,
      timestamp: new Date().toISOString(),
    };
  }
}
