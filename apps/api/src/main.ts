import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { json as expressJson, urlencoded as expressUrlencoded } from "express";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./core/http-exception.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    // Corps JSON désactivé ici : reconfiguré juste après avec une limite
    // suffisante pour l'import base64 (5 Mo décodés ≈ 6,7 Mo encodés).
    bodyParser: false,
  });

  const logger = new Logger("Bootstrap");

  // 8 Mo : laisse passer un fichier ≤ 5 Mo (base64 + enveloppe JSON) jusqu'au
  // service d'import, qui refuse au-delà avec HTTP 413. Au-delà de 8 Mo,
  // Express émet PayloadTooLargeError (aussi mappé en 413 par le filtre).
  app.use(expressJson({ limit: "8mb" }));
  app.use(expressUrlencoded({ extended: true, limit: "8mb" }));

  // En-têtes de sécurité (CDC §8 S-7).
  app.use(helmet());
  app.disable("x-powered-by");

  // P0-4 : nombre EXACT de proxys de confiance devant l'API. Topologie documentee
  // (docs/technique-exploitation.md) : un seul reverse proxy TLS (Caddy ou Nginx) -> 1.
  // 0 = API exposee directement (X-Forwarded-For ignore). Une valeur trop haute
  // permettrait a un client de choisir son IP et de contourner la limite de debit.
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "1");
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
    throw new Error("TRUST_PROXY_HOPS doit etre un entier entre 0 et 5.");
  }
  app.set("trust proxy", trustProxyHops);

  // Toutes les routes sont versionnées : /api/v1/...
  app.setGlobalPrefix("api/v1");

  const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (allowedOrigins.length === 0 && process.env.NODE_ENV === "production") {
    logger.warn("CORS_ORIGINS est vide en production : aucune origine externe ne pourra appeler l'API.");
  }

  app.enableCors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-CSRF-Token", "X-Orya-Client"],
    // Lot 10 : cookies httpOnly de session pour le client web (origines explicites uniquement).
    credentials: true,
    maxAge: 600,
  });

  // Validation stricte des entrées (CDC §8 S-7) : tout champ non déclaré est rejeté.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.API_PORT ?? 3200);
  await app.listen(port);

  logger.log(`ORYA API démarrée : http://localhost:${port}/api/v1/health`);
}

void bootstrap();
