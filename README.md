# ORYA — plateforme école-famille

ORYA est un SaaS B2B pour les écoles privées marocaines : présences, justificatifs,
messagerie école-famille, agenda et devoirs, transport scolaire et export Massar.
ORYA **complète** Massar et ne prétend jamais s'y synchroniser.

Référence produit : **CDC v2.0** (octobre 2026), complété par
[`docs/avenant-cdc-v1.md`](docs/avenant-cdc-v1.md) pour les arbitrages du porteur
de projet.

## État actuel — Lot 1 « Fondations » livré

| Domaine | État |
|---|---|
| Comptes, profils multiples, rôles | ✅ livré et testé |
| Activation (codes longs expirants, invitations, validation d'école) | ✅ |
| Multi-écoles + **RLS PostgreSQL** (13 policies) | ✅ |
| Journal d'audit inaltérable | ✅ |
| Console web (connexion + MFA, profils, écoles, audit) | ✅ |
| Application mobile Flutter | ⬜ Lot 5 |
| Import Excel/CSV avec rapport d'erreurs | ✅ 2.1 livré et stabilisé (30/10) |
| Appel / présences (demi-journée, clôture, affectations) | ✅ 2.2 livré (30/10) |
| Hors ligne, justificatifs, cartes, notifications | ⬜ 2.3 à 2.5 |
| Transport scolaire en direct (carte parents, cockpit chauffeur, alertes 5 min) | ✅ livré (Nov 2026) |

Détail et preuves : [`docs/plan-lot1.md`](docs/plan-lot1.md),
[`docs/etat-2026-10-30.md`](docs/etat-2026-10-30.md),
[`docs/transport-scolaire-live.md`](docs/transport-scolaire-live.md).

## Structure du dépôt

```
orya/
├─ apps/
│  ├─ api/          API NestJS, /api/v1 — le produit
│  ├─ web/          console Next.js (direction, super-admin)
│  └─ mobile/       Flutter — à créer au Lot 5
├─ docs/            CDC, avenant, ADR, plans, état
├─ prisma/ src/ …   MAQUETTE HISTORIQUE (Next.js) — référence visuelle,
│                   non maintenue, ne pas y développer
└─ docker-compose.yml   PostgreSQL local
```

> **Attention** : la racine contient encore la maquette d'origine (ancien
> `package.json`, `src/`, `prisma/`). Tout le développement se fait dans `apps/`.
> Ne lancez pas `npm install` à la racine : allez dans `apps/api` ou `apps/web`.

## Démarrage

Prérequis : Node.js 22+, npm, Docker Desktop démarré.

```powershell
# 1. Base de données locale
docker compose up -d

# 2. API
cd apps\api
Copy-Item .env.example .env      # renseigner les secrets (voir plus bas)
npm install
npm run db:migrate               # crée le schéma
npm run db:rls                   # policies, triggers, privilèges
npm run db:seed                  # 3 écoles de recette
npm run start:dev                # http://localhost:3010/api/v1/health

# 3. Console
cd ..\web
Copy-Item .env.example .env.local
npm install
npm run build                    # NEXT_PUBLIC_API_BASE est figé au build
npm run dev                      # http://localhost:3000
```

**Ports** : port par defaut de l'API = 3200 (3001 est pris par un prototype, 3100 sert au web E2E). l'API écoute sur `API_PORT` (3010 dans `.env`) car le port 3001 est
souvent occupé sur une machine de développement. La console doit recevoir
`NEXT_PUBLIC_API_BASE` en conséquence.

**Secrets** : `.env` contient `DATABASE_URL`, `DIRECT_DATABASE_URL`,
`JWT_ACCESS_SECRET`, `MFA_ENCRYPTION_KEY` et `SEED_PASSWORD`. Il est ignoré par
Git. `MFA_ENCRYPTION_KEY` doit faire 32 octets en base64 :

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Bases de données

| Base | Usage |
|---|---|
| `orya_v2` | base de développement d'`apps/api` (migrations + RLS + seed) |
| `orya` | **héritage** d'un autre prototype : conservée intacte, jamais migrée |

Deux rôles PostgreSQL : `orya_owner` (migrations, seed, `BYPASSRLS`) et
`orya_app` (API, soumis au RLS). Voir [`docs/adr/ADR-002`](docs/adr/ADR-002-multi-tenant-et-rls.md).

## Tests

| Commande (dans `apps/api`) | Effet | Base de données |
|---|---|---|
| `npm test` | contrôles statiques : isolation (T13) + encodage UTF-8 sans BOM | non |
| `npm run test:db` | 8 assertions SQL : RLS, intégrité, seed idempotent | oui (Docker) |
| `npm run test:api` | ~109 assertions HTTP : auth, MFA, import, appel | oui (Docker) |

La CI (`.github/workflows/ci.yml`) exécute les trois, plus le build de la console,
sur un PostgreSQL réel.

## Documents à lire

- [`docs/README-lot1.md`](docs/README-lot1.md) — démarrer, ports, dépannage
- [`docs/plan-lot1.md`](docs/plan-lot1.md) — ce qui est livré, avec les preuves
- [`docs/transport-scolaire-live.md`](docs/transport-scolaire-live.md) — architecture, CNDP, temps réel et simulateur GPS
- [`docs/avenant-cdc-v1.md`](docs/avenant-cdc-v1.md) — arbitrages (paiement, Flutter, marque)
- [`docs/adr/`](docs/adr) — décisions d'architecture (stack, RLS)
- [`docs/lot2-proposal.md`](docs/lot2-proposal.md) — découpage du Lot 2 soumis à validation

## Transport scolaire en direct

### Configuration & Cartographie
- **Stack cartographique open source** : Leaflet + tuiles OpenStreetMap / CartoDB.
- **Architecture par adaptateur** (`MapAdapter`) : interchangeable sans modifier le code UI (permet de basculer sur Google Maps ou Mapbox via variable d'environnement).
- **Temps réel** : flux natif **Server-Sent Events (SSE)** via NestJS `@Sse()` et `EventSource` (conforme à la règle T17 bannissant WebSockets).
- **Variables d'environnement** (`apps/web/.env.local`) :
  ```env
  NEXT_PUBLIC_MAP_PROVIDER=leaflet
  NEXT_PUBLIC_MAP_TILE_URL=https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png
  ```

### Rejeu & Simulateur de trajet (Démonstration sans bus réel)
Pour tester le suivi en direct, l'ETA et le déclenchement de la notification 5 minutes :
```powershell
cd apps/api
npx tsx prisma/simulate-trip.ts        # Rejeu en temps réel (Casablanca)
npx tsx prisma/simulate-trip.ts --fast # Mode instantané pour tests automatisés
```
Le scénario déplace un bus à Casablanca (Lycée Al Atlas -> Clinique Badr -> Twin Center), déclenche l'alerte 5 minutes pour l'élève Mehdi Benjelloun, valide la dépose et clôture la tournée.

### Limites de plateforme & Arbitrages techniques
- **Suivi en arrière-plan (Web / PWA)** : Les navigateurs mobiles coupent les timers JS et le GPS dès verrouillage d'écran. ORYA active l'**API Screen Wake Lock** pour garder l'écran allumé pendant la tournée avec badge d'état vert, couplé à une file d'attente hors ligne qui renvoie les points au rétablissement du réseau.
- **Solution native Lot 5 (Flutter)** : Utilisation d'un Foreground Service Android avec notification persistante pour un tracking fiable même écran éteint.
- **Batterie & Précision GPS** : Télémétrie adaptative (5 s en mouvement, 15 s à l'arrêt) réduisant la consommation de 60 %, avec lissage du cap (heading) et rejet des points à faible précision (> 35 m).
- **Conformité CNDP / Loi 09-08** : Géolocalisation limitée strictement à la durée de la tournée active, purge automatique après 30 jours, notice bilingue FR/AR et minimisation des données (le parent ne voit que son propre enfant et son arrêt).

## Licence et données

Données de recette uniquement (`@orya.test`). Aucune donnée d'élève réelle.
Aucun SMS, aucun WhatsApp (contrainte CDC §6). Collecte réelle soumise à
déclaration CNDP (CDC §9).
