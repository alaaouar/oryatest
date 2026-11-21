# Checklist de mise en production ORYA

> Version candidate : branche locale `feature/lot-10-launch`, commit `e018619` (non poussée).
> Rien n'est déployé. Les cases sont à cocher par Ayoub ; **[DÉCISION]** = choix d'Ayoub requis.

## 1. Hébergement
- [ ] **[DÉCISION]** Hébergeur et région (contrainte loi 09-08 / CNDP : hébergement au Maroc ou transfert autorisé)
- [ ] Serveur Linux avec Docker + Docker Compose, accès SSH par clé, pare-feu (80/443 uniquement)
- [ ] Construire les images `deploy/Dockerfile.api` et `deploy/Dockerfile.web` (jamais testées par `docker build` à ce jour)
- [ ] Copier `deploy/docker-compose.prod.example.yml` en `docker-compose.prod.yml` et l'adapter

## 2. Domaine et HTTPS
- [ ] **[DÉCISION]** Nom de domaine (ex. `app.<domaine>` pour le web, `api.<domaine>` pour l'API)
- [ ] DNS A/AAAA vers le serveur
- [ ] Reverse proxy TLS (Caddy ou Nginx + Let's Encrypt), redirection HTTP→HTTPS, HSTS
- [ ] `COOKIE_SECURE=true` et `COOKIE_DOMAIN` = domaine parent commun web/API (cookies SameSite=Strict : web et API doivent être sur le même site)
- [ ] `CORS_ORIGINS` = origine exacte du web

## 3. Base de données de production
- [ ] PostgreSQL 16 non exposé publiquement (réseau interne Docker)
- [ ] Rôle administrateur (migrations) distinct du rôle applicatif `orya_app` **sans BYPASSRLS**
- [ ] `npx prisma migrate deploy` puis `prisma/sql/010_rls.sql` (service `migrate`) — vérifié sur base neuve `orya_migcheck`
- [ ] **Ne jamais** lancer `prisma/seed.ts`, `db:seed:demo`, `scripts/demo-env.ps1` en production
- [ ] Vérifier après migration : 37 policies, 30 tables sous RLS (seules `User` et `_prisma_migrations` hors RLS)

## 4. Variables d'environnement (`deploy/env.prod.example`)
| Variable | Valeur attendue | Statut |
|---|---|---|
| `NODE_ENV` | `production` | |
| `API_PORT` | `3001` | |
| `CORS_ORIGINS` | origine web HTTPS | **[DÉCISION]** domaine |
| `PUBLIC_API_BASE` | URL publique de l'API (`/api/v1`) | **[DÉCISION]** domaine |
| `COOKIE_SECURE` | `true` | |
| `COOKIE_DOMAIN` | domaine parent | **[DÉCISION]** |
| `JWT_ACCESS_SECRET` | 48 octets aléatoires (hex) | à générer sur le serveur |
| `MFA_ENCRYPTION_KEY` | 32 octets base64 | à générer, **à sauvegarder hors serveur** (sinon MFA perdus) |
| `POSTGRES_ADMIN_USER` / `POSTGRES_ADMIN_PASSWORD` | admin BD | à générer |
| `ORYA_APP_PASSWORD` | mot de passe du rôle `orya_app` | à générer |
| `STORAGE_DRIVER` / `STORAGE_LOCAL_DIR` | `local` / `/var/lib/orya/storage` (volume) | **[DÉCISION]** local ou objet |
| `UPLOAD_MAX_BYTES` | `5242880` | |
| `API_RATE_LIMIT` / `AUTH_LOGIN_LIMIT` | `300` / `5` | |
| `JWT_ACCESS_TTL` | `15m` par défaut | **[DÉCISION]** réduire si besoin (voir risque session) |
| `MASSAR_CODE_PATTERN` / `MASSAR_COLUMN_LABELS` | hypothèse ORYA | à valider avec l'école |
Ne jamais définir `SEED_PASSWORD` en production.

## 5. Sauvegarde
- [ ] `scripts/backup-db.ps1` (pg_dump -Fc + SHA-256) — testé sur base jetable ; version bash/cron à écrire pour Linux
- [ ] **[DÉCISION]** Fréquence (quotidienne recommandée), rétention (30 j), stockage hors serveur chiffré
- [ ] Sauvegarder aussi le volume des justificatifs et `MFA_ENCRYPTION_KEY`

## 6. Restauration
- [ ] `scripts/restore-db.ps1` (refuse `orya`, `orya_v2`, bases existantes) — testé `orya_e2e` → `orya_restore_test`
- [ ] Test de restauration complet sur serveur de préproduction avant le pilote, puis mensuel

## 7. Rollback
- [ ] Images Docker taguées par version (commit) ; conserver la version N-1
- [ ] Sauvegarde BD juste avant chaque migration
- [ ] Les migrations ne sont pas réversibles automatiquement : rollback = restaurer la sauvegarde pré-migration + redéployer l'image N-1
- [ ] Procédure écrite et répétée une fois en préproduction

## 8. Avant ouverture à l'école pilote
- [ ] Tests verts sur la version livrée (API, DB, E2E)
- [ ] Supervision `/api/v1/health`, disque, erreurs ; alerte
- [ ] **[DÉCISION]** Canal de support (e-mail/téléphone), conditions pilote, contrat et DPA

---

## Mise à jour du 3 novembre 2026 — corrections préproduction (local, non commité)

> Statuts utilisés : **Validé en local (preuve)** = exécuté sur le poste de dev, sur base jetable, avec log ;
> **Non vérifié** = rien n'a été exécuté. Le statut « Validé » (production) reste réservé à Ayoub.

### Validé en local (preuve)

| Point | Résultat | Preuve |
|---|---|---|
| Révocation immédiate des sessions | Le garde JWT vérifie la session (`Device`, `sid` du jeton, lecture par clé primaire). Après logout : jeton d'accès rejoué → 401, refresh rejoué → 401 ; l'autre appareil reste valide (logout = session courante ; pas de « logout all », la révocation d'un appareil coupe ses jetons d'accès). | `npm run test:api` : 363 succès / 0 échec (assertions `L10-S`) ; suite preprod : 200 → 401 → 401 → 401 |
| Menu responsive | ≥ 761 px : entrées à la ligne ; ≤ 760 px : bouton « Menu » (`aria-expanded`, `aria-controls`, focus visible). Tableaux super-admin défilant dans leur carte. | Suite preprod : 4 rôles × 390/768/1024/1440, 76 pages, 0 entrée masquée, 0 débordement horizontal |
| Images Docker | `orya-api:local-e018619` (842 MB) et `orya-web:local-e018619` (864 MB) construites, non publiées. Ajout de `.dockerignore` ; `Dockerfile.api` aligné sur npm 11 (lockfile). | `C:\Users\YEP\docker-build-api-final2.log`, `C:\Users\YEP\docker-build-web.log` |
| Smoke test Docker (base jetable `orya_dockersmoke` dans un conteneur postgres:16 dédié, supprimé ensuite) | `prisma migrate deploy` depuis l'image API OK, RLS appliqué (37 policies), santé API `database: ok`, conteneur `healthy`, login parent 200 (cookies HttpOnly/SameSite=Strict, aucun jeton dans le corps), `/me` 200, POST sans CSRF 403, refresh avec CSRF 200, logout 200, jeton rejoué 401, web `/login` 200, CORS 204 pour l'origine web, bundle navigateur pointant vers l'API, web → API par le réseau Docker 200, aucune erreur ni mot de passe dans les logs API. | `C:\Users\YEP\docker-smoke-summary.log` (+ `docker-smoke-*.log`, `docker-smoke-cleanup.log`) |
| Lint web | ESLint 9 « flat » (`eslint-config-next` 16.4.2, core-web-vitals + TypeScript), `npm run lint` = `eslint .` : 0 erreur, 26 avertissements (justifiés dans `eslint.config.mjs`). | `C:\Users\YEP\web-lint-2.log` |

Points relevés pendant le smoke test :
- `prisma/sql/000_roles.sql` contient `GRANT CONNECT ON DATABASE orya` : il échoue si la base a un autre nom (les rôles sont tout de même créés). Cela convient à la compose prod (base `orya`), mais c'est à paramétrer si le nom change.
- Le service `migrate` de la compose exemple lance `npx tsx prisma/apply-sql.ts`, alors que `tsx` est retiré de l'image (`npm prune --omit=dev`). Dans le smoke test, le RLS a été appliqué par `psql`. **À corriger avant le serveur.**
- Le web n'appelle l'API que depuis le navigateur (`NEXT_PUBLIC_API_BASE` figé au build). Il faut reconstruire l'image web pour chaque domaine.

### Non vérifié (aucune exécution)

- HTTPS et cookie `Secure` (`COOKIE_SECURE=true`) derrière un vrai certificat.
- Hébergement (fournisseur, région, sauvegardes managées) — **décision Ayoub**.
- Domaine et DNS (`COOKIE_DOMAIN`, `CORS_ORIGINS`) — **décision Ayoub**.
- Restauration de sauvegarde sur le serveur cible (seulement testée sur base locale jetable).
- Test de charge (coût de la lecture de session ajoutée à chaque requête, limites de débit).
- Démarrage via `docker compose` complet (seuls des `docker run` ont été testés).

## Livraison technique — version candidate du 3 novembre 2026 (local, non commité, non publié)

### Versions exactes
- Commit de référence : `e0186192ec6ede5e47458b6dce40cd6918fee44b` + modifications locales non commitées.
- Empreinte de l'arbre de travail : `c25d364aeac4bec8e5cfe6c42a6cf2b3c9e0230a99aa278f3921d702802de3ed`.
- Images (détail et IDs : `docs/RELEASE_MANIFEST.md`) :
  - `orya-api:rc-e018619-20261103-c25d364a` (`608f642d20f1`)
  - `orya-api-migrate:rc-e018619-20261103-c25d364a` (`af1e8dd52470`)
  - `orya-web:rc-e018619-20261103-c25d364a` (`348767732147`, API de test `http://127.0.0.1:3013/api/v1` figée)

### Fichiers modifiés non commités (git status au moment du build)
Modifiés : `apps/api/prisma/apply-sql.ts`, `apps/api/prisma/sql/000_roles.sql`, `apps/api/src/auth/guards.ts`,
`apps/api/src/auth/token.service.ts`, `apps/api/test/api/run-api-tests.ps1`, `apps/web/app/(console)/attendance/page.tsx`,
`apps/web/app/(console)/family/messages/page.tsx`, `apps/web/app/(console)/family/page.tsx`, `apps/web/app/(console)/layout.tsx`,
`apps/web/app/globals.css`, `apps/web/package-lock.json`, `apps/web/package.json`, `deploy/Dockerfile.api`,
`deploy/docker-compose.prod.example.yml`, `docs/ROADMAP_FINALISATION_ORYA.md`, `docs/technique-exploitation.md`, `e2e/.gitignore`.
Non suivis : `.dockerignore`, `apps/web/eslint.config.mjs`, `docs/CHECKLIST_MISE_EN_PRODUCTION.md`, `docs/guide/`, `e2e/guide/`,
`e2e/make-run-guide.ps1`, `e2e/make-run-preprod.ps1`, `e2e/playwright.guide.config.ts`, `e2e/playwright.preprod.config.ts`,
`e2e/preprod-out/`, `e2e/preprod/`, `e2e/run-preprod.ps1` ; ajouté ensuite : `docs/RELEASE_MANIFEST.md`.

### Résultats des tests (3 novembre 2026, sur cet état)
| Test | Résultat |
|---|---|
| `npm test` (API, statique) | OK — tenancy 102 fichiers, encodage 214 fichiers |
| `npm run test:db` | OK — 18 contrôles RLS/seed (1er passage : coupure transitoire `localhost:5432` pendant le seed, relancé OK) |
| `npm run test:api` | 363 succès, 0 échec |
| E2E Playwright (`run-e2e.ps1`) | 4/4 passés |
| Lint web | 0 erreur, 22 avertissements (26 avant ; 4 corrigés, voir ci-dessous) |
| Typecheck web / build web / build API | OK |
| Docker Compose jetable (`orya-compose-test`, base `orya_compose_test`) avec les images `rc-…` | OK : ordre postgres→migrate→api→web, healthchecks, 12 migrations, 37 policies, 30 tables FORCE RLS, auth (login 200, /me 200, POST sans CSRF 403, refresh 200, logout 200, rejeu jeton 401) ×3 (démarrage, restart, down/up), données persistées, aucun secret dans les logs |
| Secrets dans les images | aucun fichier `.env`/clé (seul `/app/.env.example` dans l'image web), aucune variable sensible dans `Config.Env`, aucun secret dans `docker history`, aucun motif secret dans `/app` |

### Avertissements ESLint (26 → 22)
- 4 corrigés (accessibilité, effet fonctionnel pour lecteurs d'écran) : `aria-pressed` invalide sur `role="tab"`
  (`family/page.tsx`, 3 onglets → `aria-selected`) et sur `role="listitem"` (`attendance/page.tsx` → `aria-current`) ;
  sélecteurs CSS ajoutés, rôles conservés (utilisés par les tests E2E).
- 22 conservés : `react-hooks/set-state-in-effect`, motif « charger au montage » (`useEffect(() => { void load(); }, [load])`).
  Les dépendances des `useCallback` ne contiennent pas l'état modifié : pas de boucle. Faible gravité.
  Points à surveiller (non corrigés, sans refonte) : absence d'annulation des requêtes quand le filtre change vite
  (`agenda`, `attendance`, `family/agenda`, `massar`, `lib/direction-dashboard.tsx`) — une réponse ancienne peut
  écraser une plus récente ; `family/agenda` remet `data` à `null` (clignotement voulu du chargement) ;
  `layout.tsx` referme le menu à chaque navigation (voulu).

### Variables d'environnement
- Postgres : `POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD` (base `orya`).
- Job migrate : `DIRECT_DATABASE_URL` (admin), `DATABASE_URL` (orya_app, différente), `ORYA_APP_PASSWORD`, `APPLY_ROLES=1` (défaut image).
- API obligatoires : `DATABASE_URL` (orya_app), `JWT_ACCESS_SECRET` (48 octets hex), `MFA_ENCRYPTION_KEY` (32 octets base64),
  `CORS_ORIGINS` (origine exacte du web), `COOKIE_SECURE=true`, `COOKIE_DOMAIN`.
- API optionnelles : `API_PORT`, `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `UPLOAD_MAX_BYTES`, `API_RATE_LIMIT`, `AUTH_LOGIN_LIMIT`,
  `ACCESS_COOKIE_MAX_AGE_S`, `REFRESH_COOKIE_MAX_AGE_S`, `ARGON2_*`, `ACTIVATION_*`, `IMPORT_*`, `UPLOAD_RATE_LIMIT`, `MASSAR_*`.
- Web (au build uniquement) : `NEXT_PUBLIC_API_BASE` via `PUBLIC_API_BASE`.

### Procédure de démarrage Docker Compose
1. `cp deploy/docker-compose.prod.example.yml deploy/docker-compose.prod.yml` ; remplir `deploy/.env.prod` (jamais commité).
2. Construire les images (voir `docs/RELEASE_MANIFEST.md`), web avec l'URL HTTPS de l'environnement.
3. `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d`
   → postgres healthy → migrate (prisma migrate deploy + rôles + RLS, idempotent) terminé avec succès → api healthy → web.
4. Contrôles : `docker compose ps` (migrate `Exited (0)`, api/web `healthy`), `GET /api/v1/health` → `database: ok`,
   `select count(*) from _prisma_migrations` = 12, `select count(*) from pg_policies` = 37.
5. Seed : uniquement le compte super-admin initial en production ; jamais le seed de démonstration.

### Prérequis préproduction HTTPS
- Domaines `app.` et `api.` (DNS), reverse proxy TLS (Caddy/Nginx) devant web:3000 et api:3001, HTTP→HTTPS, HSTS.
- `COOKIE_SECURE=true`, `COOKIE_DOMAIN` du domaine parent, `CORS_ORIGINS=https://app.<domaine>`.
- Image web reconstruite avec `NEXT_PUBLIC_API_BASE=https://api.<domaine>/api/v1` et vérifiée (grep du bundle).
- Secrets générés sur le serveur, hors dépôt ; postgres sans port publié ; volumes `pgdata` et `storage` sauvegardés.

### Sauvegarde / restauration (procédure, non testée sur l'hébergement)
- Sauvegarde base : `docker compose exec -T postgres pg_dump -U $POSTGRES_ADMIN_USER -d orya -Fc > orya-AAAAMMJJ.dump`
- Sauvegarde fichiers : `docker run --rm -v orya-prod_storage:/s -v $PWD:/b alpine tar czf /b/storage-AAAAMMJJ.tgz -C /s .`
- Restauration (base vide) : démarrer postgres seul, `pg_restore -U ... -d orya --clean --if-exists < dump`, restaurer le tar du
  stockage, puis `up -d` (migrate rejoue sans effet). Tester la restauration sur une base jetable avant ouverture.
- Copie hors serveur chiffrée, rétention à définir.

### Points restant à valider
- Commit de cet état (non fait, volontairement) puis reconstruction des images depuis le commit propre.
- Image web de préproduction avec l'URL HTTPS réelle ; test derrière TLS (cookies `Secure`, CORS, HSTS).
- Restauration réelle d'une sauvegarde ; rotation des secrets ; supervision/logs.
- Image API runtime : `prisma` et `typescript` restent dans `node_modules` (dépendances pair installées par npm, déjà le cas avant) — allègement possible.
- Les 22 avertissements `set-state-in-effect` (annulation des requêtes concurrentes).

## Pré-production : stockage des fichiers et journal des suppressions (bloc 3b)
> Ajouté le 05/11/2026 (décision t49u). Ces points ne sont **pas** couverts par verify-all (conteneurs jetables locaux SeaweedFS/ClamAV uniquement).
- [ ] **[DÉCISION]** Fournisseur de stockage objet (S3 ou compatible) et région (loi 09-08 / CNDP)
- [ ] Test sur le **vrai fournisseur** : bucket privé (Block Public Access), lecture non signée refusée (403)
- [ ] URL pré-signées : durée effective ≤ `STORAGE_PRESIGN_SECONDS` (30-300 s, défaut 120), signature altérée refusée, `Content-Disposition: attachment`
- [ ] Chiffrement : SSE-S3 (AES256) ou SSE-KMS vérifié par `HeadObject` sur un objet réel ; clé KMS et rotation documentées
- [ ] ClamAV de production joignable par l'API (`CLAMAV_HOST`/`CLAMAV_PORT`), signatures à jour (freshclam), test EICAR → 422 ; arrêt de ClamAV → fichier non téléchargeable (409)
- [ ] Reprise des anciens justificatifs : `npx tsx prisma/run-file-pending.ts --rescan` ; purge éventuelle uniquement avec `ORYA_PENDING_PURGE_ALLOW=1 --purge --before=… --confirm=<base>`, après accord écrit
- [ ] Journal des suppressions (`DELETION_REGISTER_JOURNAL`) sur un **stockage séparé** de la base et de ses sauvegardes, avec **verrouillage en écriture** (WORM / Object Lock en mode conformité, ou attribut append-only), test de rejeu après restauration (`scripts/restore-db.ps1 -Replay`)
- [ ] `DELETION_REGISTER_HMAC_KEY` conservée hors base et hors serveur applicatif (coffre), procédure de rotation
- [ ] Durées de conservation **provisoires** (justificatif 365 j, scan de consentement 1825 j) : **[DÉCISION]** validation par le juriste

## Pré-production : environnement, harnais et fumée (t62u, 12/11/2026)
> Runbook : `docs/preproduction.md`. Fichiers : `deploy/docker-compose.preprod.example.yml`, `deploy/env.preprod.example` (emplacements seulement).
- [ ] Environnement `orya-preprod` monté (base `orya_preprod`, S3 fichiers, ClamAV interne, journal WORM), aucune donnée réelle
- [ ] Bucket du journal des suppressions créé **avec Object Lock**, rétention par défaut COMPLIANCE (**[DÉCISION]** durée), 3 jeux d'identifiants (écriture seule pour l'API, lecture seule au coffre, administrateur hors ligne) — code et tests : BLOC6 W0-W14 (S3 jetable)
- [ ] `scripts/test-s3-provider.ps1` vert chez le fournisseur (BLOC verify-all : `-Disposable` sur S3 jetable) ; chiffrement par défaut du bucket activé
- [ ] `scripts/preprod-smoke.ps1 -BaseUrl https://api.preprod…/api/v1` vert (19 contrôles) ; `/health` expose l'état des migrations (agrégats seulement)
- [ ] Exercice de restauration + `restore-db.ps1 -Replay` avec les identifiants de **lecture** WORM, sans fichier local
- [ ] Ouvert : rétractation d'une suppression de compte par l'utilisateur impossible (compte désactivé et sessions révoquées dès la demande) — **[DÉCISION]** circuit (support / lien e-mail)
- [ ] Ouvert : activation d'un nouveau compte pendant la suspension d'une école toujours bloquée (inchangé, t62u A3) — **[DÉCISION]**
- [ ] Facturation en pré-production : `BILLING_ISSUER_*` absentes → émission refusée (attendu) ; identité légale réelle seulement pour la recette comptable
