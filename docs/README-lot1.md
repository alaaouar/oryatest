# ORYA — Lot 1 : état et démarrage

Le socle de la nouvelle application est dans `apps/api`. La maquette d'origine, à la
racine du dépôt, **n'a pas été modifiée** : elle reste la référence visuelle.

## Ce qui est déjà fait (29 octobre 2026)

- [x] Schéma de données du Lot 1 validé par Prisma
- [x] Migration DDL générée (302 lignes) et appliquée sur quatre bases de test
- [x] Rôles `orya_owner` (BYPASSRLS) et `orya_app` (NOBYPASSRLS) créés
- [x] Policies RLS, triggers et privilèges appliqués — **prouvés par 8 tests SQL**
- [x] Seed de recette 3 écoles — **idempotent**
- [x] Dépendances installées (`npm install` → 445 paquets)
- [x] Code NestJS — **TypeScript compile, build OK**
- [x] API compilée et **démarrée pour de vrai** : `GET /api/v1/health` → 200
- [x] **Authentification complète** : Argon2id, MFA TOTP, refresh rotatif,
      verrouillage progressif, révocation d'appareil — **36 tests HTTP passés**
- [x] Journal d'audit consultable par l'école et par le super-admin
- [x] Avenant au CDC + décisions d'architecture

## API v1 — surface actuelle

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/health` | public | — |
| POST | `/auth/login` | public (5/min par IP) | — |
| POST | `/auth/mfa/enroll` | défi MFA | — |
| POST | `/auth/mfa/verify` | défi MFA | — |
| POST | `/auth/refresh` | jeton de rafraîchissement | — |
| POST | `/auth/logout` | jeton d'accès | tous |
| GET | `/me` | jeton d'accès | tous |
| POST | `/me/profiles/select` | jeton d'accès | tous |
| GET | `/me/devices` | jeton d'accès | tous |
| DELETE | `/me/devices/:id` | jeton d'accès | tous |
| GET | `/students` | jeton + MFA si direction | direction, enseignant, super-admin |
| GET | `/students/:id` | idem | idem |
| GET | `/audit` | jeton + **MFA obligatoire** | direction, super-admin |
| POST | `/activation/parent` | public | — |
| POST | `/activation/invitation` | public | — |
| POST | `/schools` | jeton + MFA | super-admin |
| POST | `/schools/:id/validate` | jeton + MFA | super-admin |
| POST | `/invitations` | jeton + MFA | direction |

### Parcours de connexion

1. `POST /auth/login` avec e-mail + mot de passe.
2. Si le profil actif est **direction** ou **super-admin**, la réponse contient
   `mfaRequired: true`, `method: "enroll"` ou `"verify"`, et un `challengeToken`
   (5 minutes). **Aucun jeton d'accès n'est émis à ce stade.**
3. Premier passage : `POST /auth/mfa/enroll` → `secret` + `otpauthUrl`
   (à scanner avec Google Authenticator).
4. `POST /auth/mfa/verify` avec `challengeToken` + code à 6 chiffres → jetons.
5. Les autres profils (parent, enseignant, élève, accompagnateur) reçoivent
   directement leurs jetons.

## Ce qui reste à faire par vous (5 étapes)

### 1. Définir les mots de passe des deux rôles

Les rôles existent mais n'ont **aucun mot de passe** : personne ne peut s'y connecter.

```powershell
docker exec -it <conteneur-de-dev> psql -U <admin> -d <base-de-dev> -c "ALTER ROLE orya_owner PASSWORD 'votre-mot-de-passe-owner';"
docker exec -it <conteneur-de-dev> psql -U <admin> -d <base-de-dev> -c "ALTER ROLE orya_app   PASSWORD 'votre-mot-de-passe-app';"
```

### 2. Créer le fichier d'environnement

```powershell
cd C:\Users\YEP\Projects\orya\apps\api
Copy-Item .env.example .env
notepad .env      # remplacez CHANGEME partout
```

Trois valeurs doivent être générées, pas inventées :

```powershell
# JWT_ACCESS_SECRET (32 caractères minimum)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# MFA_ENCRYPTION_KEY (32 octets en base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`SEED_PASSWORD` (12 caractères minimum) servira aux comptes de démonstration.

### 3. Appliquer la migration à votre base de développement

```powershell
npm run db:migrate
npm run db:rls
npm run db:seed
```

> Ces trois commandes écrivent dans la base `orya`. Elles n'ont **pas** été exécutées
> par les tests : c'est à vous de les lancer.

### 4. Démarrer l'API

```powershell
npm run start:dev
```

Puis, dans un autre terminal :

```powershell
curl http://localhost:3001/api/v1/health
```

### 5. Rejouer les tests quand vous voulez

```powershell
cd C:\Users\YEP\Projects\orya
powershell -ExecutionPolicy Bypass -File .\scripts\test-pg-up.ps1          # cree orya-test-pg (127.0.0.1:55433, volume orya-test-pg-data)
powershell -ExecutionPolicy Bypass -File .\apps\api\test\db\run-db-tests.ps1
powershell -ExecutionPolicy Bypass -File .\apps\api\test\api\run-api-tests.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test-pg-down.ps1        # supprime orya-test-pg et son volume (etiquette created-by=orya-test verifiee)
```

Les scripts de test ne visent **que** le conteneur jetable `orya-test-pg` (variables
`ORYA_TEST_CONTAINER`, `ORYA_TEST_PORT`, `ORYA_TEST_DB` pour le rediriger vers un autre conteneur
jetable etiquete). La garde `scripts/test-guard.ps1` refuse (code 3), avant toute commande, le
conteneur `orya-postgres`, le port 5432 et les bases `orya`, `orya_v2`, `postgres`, `template0`,
`template1`. `SEED_PASSWORD` est genere aleatoirement pour chaque execution (jamais affiche) et
l'ancienne valeur est restauree en fin de script.
Bases jetables recréées dans orya-test-pg : `orya_lot1_rls`, `orya_lot1_rls_seed`, `orya_lot1_auth`. Le test d'API crée un rôle propre à la base (`orya_t_<base>`, NOBYPASSRLS, mot de passe aléatoire) : `orya_app` n'est pas modifié et aucun `ALTER ROLE` global n'est exécuté.

---

## Cartographie des fichiers

```
apps/api/
├─ prisma/
│  ├─ schema.prisma                 10 modèles du Lot 1
│  ├─ migrations/…                  DDL générée par Prisma
│  ├─ sql/000_roles.sql             rôles PostgreSQL (une fois)
│  ├─ sql/010_rls.sql               policies, triggers, privilèges (idempotent)
│  ├─ apply-sql.ts                  exécuteur de 010_rls.sql
│  └─ seed.ts                       3 écoles de recette
├─ src/
│  ├─ main.ts                       démarrage, helmet, CORS, validation stricte
│  ├─ app.module.ts                 validation de l'environnement, débit global
│  ├─ core/prisma.service.ts        connexion rôle applicatif (RLS actif)
│  ├─ core/tenancy.service.ts       contexte d'école / identité par transaction
│  ├─ core/crypto.ts                SHA-256, jetons aléatoires, AES-256-GCM
│  ├─ core/http-exception.filter.ts erreurs génériques, détails côté serveur
│  ├─ auth/                         connexion, MFA, jetons, gardes, décorateurs
│  ├─ audit/                        journal d'audit (écriture + consultation)
│  ├─ students/                     lecture d'élèves (preuve d'isolation)
│  └─ health/                       sonde /api/v1/health
├─ test/db/                         RLS, intégrité, seed
└─ test/api/                        authentification, rôles, sessions, isolation
```

## Règle d'or

Toute requête métier passe par `TenancyService.run()`. Une requête écrite directement
sur `PrismaService` pour une table métier est un défaut de sécurité (voir
`docs/adr/ADR-002-multi-tenant-et-rls.md`).

## En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| `password authentication failed for user "orya_app"` | mot de passe non défini (étape 1) | `ALTER ROLE … PASSWORD` |
| `permission denied for table …` | `010_rls.sql` non appliqué | `npm run db:rls` |
| `0 ligne` alors que des données existent | contexte `app.school_id` absent | passer par `TenancyService` |
| `new row violates row-level security policy` | `schoolId` différent du contexte | le `schoolId` doit venir de la session |
| `Configuration invalide : MFA_ENCRYPTION_KEY …` | clé absente ou mal formée | regénérer la clé (étape 2) |
| `401` après connexion | jeton expiré (15 min) | `POST /auth/refresh` |
| `403` sur `/students` | rôle `parent` ou `élève` | comportement attendu |
| `429` à la connexion | 5 essais/min ou compte verrouillé | attendre, ou réinitialiser `lockedUntil` |
| Docker : `permission denied … dockerDesktopLinuxEngine` | Docker Desktop arrêté | le démarrer |
| `EADDRINUSE :::3001` | un autre programme occupe le port 3001 | changer `API_PORT` dans `.env` |

---

## Console web (Lot 1)

```powershell
cd C:\Users\YEP\Projects\orya\apps\web
Copy-Item .env.example .env.local
npm install
npm run dev
```

Ouvrir http://localhost:3000.

**Attention au port de l'API.** Sur cette machine, le port 3001 est deja utilise par
une autre application (elle repond `307 -> /connexion`). Choisissez un port libre :

```powershell
# apps/api/.env
API_PORT=3010
CORS_ORIGINS="http://localhost:3000"

# apps/web/.env.local  (puis npm run build avant npm start)
NEXT_PUBLIC_API_BASE="http://localhost:3010/api/v1"
```

`NEXT_PUBLIC_API_BASE` est integre au build : il faut reconstruire la console
(`npm run build`) apres l'avoir modifie.

---

## Durcissement (29 octobre 2026)

Nouvelles variables d'environnement (defauts surs, aucune obligation de les definir) :

| Variable | Defaut | Role |
|---|---|---|
| `ACTIVATION_MAX_FAILURES` | 10 | echecs avant verrouillage |
| `ACTIVATION_WINDOW_MINUTES` | 15 | fenetre de comptage |
| `ACTIVATION_LOCK_MINUTES` | 15 | duree du verrouillage |
| `ACTIVATION_RATE_LIMIT` | 10 | requetes/min par IP sur `/activation/*` |

Activation d'un parent : `POST /activation/parent` avec `schoolCode` + `activationCode`
(code long remis par l'ecole, 30 jours par defaut, jamais stocke en clair).
La direction emet ce code avec `POST /students/:id/activation-code`.

Controles avant commit / CI :

```powershell
cd apps\api
npm run test:static      # isolation (T13) + encodage UTF-8 sans BOM
```

Un etablissement `pending` est redirige vers `/pending` : aucune donnee scolaire
n'est accessible avant validation par ORYA.
