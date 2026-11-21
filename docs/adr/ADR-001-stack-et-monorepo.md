# ADR-001 — Stack cible et organisation du code

**Date :** 29 octobre 2026
**Statut :** accepté

## Contexte

Le code existant est une maquette Next.js monolithique (Server Actions, un seul
établissement codé en dur, aucune authentification). Le CDC v2.0 §11 impose une
architecture multi-plateforme : Flutter pour le terrain, Next.js pour la console,
NestJS pour l'API, PostgreSQL avec RLS.

## Décision

1. **Monorepo** contenant trois applications et deux paquets partagés :

   ```
   orya/
   ├─ apps/api       NestJS — API versionnée /api/v1
   ├─ apps/web       Next.js — console Direction + Super-admin
   ├─ apps/mobile    Flutter — Parent, Enseignant, Élève, Accompagnateur
   ├─ packages/api-client    client TypeScript généré depuis OpenAPI
   └─ packages/design-tokens couleurs, typographie, espacements
   ```

2. **L'API est la seule source de vérité métier.** La console web n'écrit jamais en base
   directement et n'utilise pas de Server Actions pour la logique métier : elle appelle
   `/api/v1`. Cela permet à Flutter et à Next.js de consommer le même contrat.

3. **Contrat OpenAPI** généré par NestJS (`@nestjs/swagger`), client TypeScript généré
   pour `apps/web`. Une seule définition des types côté client.

4. **L'ancienne maquette est conservée**, taguée `maquette-v1`, et sert de référence
   visuelle. Aucun de ses fichiers n'est supprimé ni déplacé pendant le Lot 1.

5. **npm workspaces** (pas de nouvel outil à apprendre). Le fichier `package.json` racine
   sera converti en workspaces au moment de la création de `apps/web`, pas avant.

## Conséquences

- Trois cibles de déploiement (API, console, mobile) : la CI devra être séparée par
  application.
- L'authentification doit être pensée pour **trois clients** dès le départ (jetons
  d'accès courts + refresh rotatif, stockage sécurisé côté mobile).
- Le mode hors ligne (appel, transport) impose un protocole de synchronisation
  idempotent (identifiants générés côté client) : à concevoir au Lot 2.
- Un développeur débutant doit accepter que le Lot 1 ne produise **aucune interface
  visible** : il produit le socle (base, RLS, identité, audit).

## Alternatives écartées

| Alternative | Motif du rejet |
|---|---|
| Rester sur le monolithe Next.js + PWA | Contraire au CDC §11, pas de push natif, pas de sécurité mobile (§8 S-6) |
| Backend dans Next.js et mobile Flutter | Deux logiques métier à maintenir, contradiction avec §11 |
| Démarrer par le mobile | Construirait trois interfaces sur des fondations instables |
