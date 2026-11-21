# @orya/api — API ORYA (NestJS)

API versionnée `/api/v1` de la plateforme ORYA. Seule source de vérité métier :
la console web (Next.js) et l'application mobile (Flutter, Lot 2) la consomment.

## Rôle des deux URL de base

| Variable | Rôle PostgreSQL | Usage |
|---|---|---|
| `DATABASE_URL` | `orya_app` (NOBYPASSRLS) | exécution de l'API — soumis au RLS |
| `DIRECT_DATABASE_URL` | `orya_owner` (BYPASSRLS) | migrations, RLS, seed |

Ne jamais inverser : utiliser `orya_owner` dans l'API contournerait tout l'isolation.

## Commandes

| Commande | Effet |
|---|---|
| `npm run start:dev` | API en mode développement |
| `npm run build` | compilation TypeScript vers `dist/` |
| `npm run prisma:generate` | génère le client Prisma |
| `npm run db:migrate:create -- --name <nom>` | crée une migration **sans l'appliquer** |
| `npm run db:migrate` | applique les migrations (développement) |
| `npm run db:deploy` | applique les migrations (préproduction/production) |
| `npm run db:rls` | applique les policies RLS, triggers et privilèges |
| `npm run db:seed` | charge les données de recette (3 écoles) |

## Règle d'or

Toute requête métier passe par `TenancyService.run()`, qui ouvre une transaction et pose
le contexte d'école. Une requête écrite directement sur `PrismaService` et portant sur
une table métier est un défaut de sécurité (voir ADR-002).

## Structure

```
prisma/schema.prisma      modèle de données du Lot 1
prisma/sql/000_roles.sql  rôles PostgreSQL (une seule fois, en superutilisateur)
prisma/sql/010_rls.sql    policies, triggers, privilèges (idempotent)
prisma/apply-sql.ts       exécuteur du fichier 010_rls.sql
prisma/seed.ts            3 écoles de recette déterministes
src/core/                 Prisma, contexte tenant, filtre d'erreurs
src/health/               sonde de disponibilité
```
