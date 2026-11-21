# Plan du Lot 1 — « Fondations » (CDC §16)

Objectif du lot : *comptes, choix de profil, activation d'accès, multi-écoles, RLS,
journal d'audit, seed de recette.*

Une case n'est cochée que lorsque le résultat a été **exécuté et observé**.

---

## 1. Livré et vérifié

| Élément | Fichier | Vérification exécutée |
|---|---|---|
| Schéma de données (10 modèles) | `apps/api/prisma/schema.prisma` | `prisma validate` → *schema is valid* |
| Migration DDL (302 lignes, générée par Prisma) | `prisma/migrations/20261029185000_lot1_foundations/` | appliquée sur 4 bases, exit 0 |
| Rôles PostgreSQL `orya_owner` / `orya_app` | `prisma/sql/000_roles.sql` | appliqué 2 fois, idempotent |
| Policies RLS + triggers + privilèges | `prisma/sql/010_rls.sql` | appliqué 2 fois ; **11 policies**, 9 tables en `FORCE RLS` |
| Exécuteur SQL | `prisma/apply-sql.ts` | logique reprise par les tests |
| Seed de recette 3 écoles | `prisma/seed.ts` | exécuté 2 fois → compteurs identiques |
| Module `auth` (connexion, MFA, sessions) | `src/auth/**` | **36 tests HTTP passés** |
| Isolation de bout en bout | `src/students/**` + RLS | tests T1, T4, T5 passés via HTTP |
| Journal d'audit | `src/audit/**` | 15 événements de session + 5 événements d'école observés en base |
| Limitation de débit | `app.module.ts` + `auth.controller.ts` | 5 connexions/min par IP par défaut |
| Socle NestJS (config, erreurs, Prisma, tenancy, /health) | `src/main.ts`, `src/core/**` | `tsc` exit 0, `nest build` exit 0, `/health` → 200 |
| Tests base de données | `test/db/**` | T1, T2, T3, T5, T6, T7, T8, T9 → OK |
| Tests d'API | `test/api/**` | 36 / 36 OK |
| Avenant CDC + décisions d'architecture | `docs/` | — |

### Résultats mesurés le 29 octobre 2026

```
Base de test (orya_lot1_rls) :
  AuditLog, Consent, Device, Guardian, Invitation, School, Student,
  StudentGuardian, UserProfile      → rls_active = t, force_rls = t
  User                              → sans RLS (décision ADR-002)
  policies = 11, triggers = 2

Tests base (rôle orya_app) :
  T1 OK — école A ne voit que ses 2 élèves et ses 2 liens
  T2 OK — 0 ligne visible sans contexte d'école
  T3 OK — écriture dans une autre école refusée par la policy
  T5 OK — école B ne voit que son élève et aucun lien de A
  T6 OK — troisième responsable refusé (ORYA_MAX_GUARDIANS)
  T7 OK — modification du journal d'audit refusée (ORYA_AUDIT_IMMUTABLE)
  T8 OK — DROP TABLE refusé au rôle applicatif
  T9 OK — orya_app ne peut pas modifier le journal d'audit

Seed (orya_lot1_seed, deux exécutions) :
  3 écoles, 13 comptes, 13 profils, 6 élèves, 6 responsables,
  12 liens, 12 consentements — identique aux deux exécutions.

Tests d'API (base orya_lot1_auth, rôle orya_test NOBYPASSRLS) : 36 / 36
  connexion inconnue → 401 générique
  direction sans MFA → défi, aucun jeton
  enrôlement TOTP + code invalide refusé + code valide → jetons
  /me → profils, aucun hash exposé
  A voit 2 élèves, B voit 2 élèves, A→élève de B → 404, B→élève de A → 404
  enseignant : élèves OK, journal d'audit → 403
  parent : /students → 403
  sans jeton → 401, jeton falsifié → 401
  rotation du refresh OK, rejeu de l'ancien → 401, appareil révoqué → 401
  journal d'école consultable et connexion tracée
  déconnexion → refresh impossible
  6 échecs de connexion → verrouillage (429)
```

### Défauts trouvés puis corrigés pendant l'exécution

1. **Seed** — `activeProfileId` référencé avant la création du profil : violation de
   clé étrangère. Corrigé (compte → profil → mise à jour).
2. **Seed** — `process.env.SEED_PASSWORD` non rétréci à `string` : `tsc` échouait.
3. **Tests** — fixtures et seed partageaient les mêmes UUID : compteurs faussés.
4. **Build** — `nest build` n'émettait rien (`incremental` + `tsc --noEmit` antérieur).
   Corrigé par `tsconfig.build.json`.
5. **Scripts de test** — UTF-8 sans BOM illisible par Windows PowerShell 5.1,
   variable `$args` réservée.
6. **Jetons** — `expiresIn` refusé par les types de `jsonwebtoken` : conversion typée.
7. **Tests HTTP** — le corps d'une réponse 4xx n'était pas lu par le helper
   PowerShell ; corrigé via `ErrorDetails.Message`.
8. **GRANT** — `"AuditLog"` perdait ses guillemets dans un argument `psql -c` :
   déplacé dans un fichier SQL.

---

## 2. Non livré — incrément suivant

- [ ] Module `activation` : invitations, code école + code élève, maximum 2 responsables
- [ ] Module `schools` : création/validation d'une école par le super-admin
- [ ] Sélecteur de profil côté client (l'API `/me/profiles/select` existe et est testée)
- [ ] Console web `apps/web` (thème CDC §14)
- [ ] Test T13 : vérification statique qu'aucune requête métier n'est écrite hors `TenancyService`
- [ ] Anti-rejeu d'un code TOTP dans la même fenêtre de 30 s (colonne `mfaLastStep` + migration)

---

## 3. Batterie de tests

| # | Test | État | Nature |
|---|---|---|---|
| T1 | Contexte école A → seuls les élèves de A | ✅ exécuté (SQL + HTTP) | RLS |
| T2 | Sans contexte → 0 ligne | ✅ exécuté | RLS |
| T3 | Écriture avec `schoolId` d'une autre école → refusée | ✅ exécuté | RLS |
| T4 | Jeton de A → `GET /students/:id_de_B` → 404 | ✅ exécuté (HTTP) | API + RLS |
| T5 | Trois écoles, aucun croisement | ✅ exécuté (2 écoles en HTTP, 3 en seed) | RLS |
| T6 | 3ᵉ responsable → refusé | ✅ exécuté | Trigger |
| T7 | `UPDATE` du journal d'audit → refusé | ✅ exécuté | Trigger |
| T8 | `DROP TABLE` par le rôle applicatif → refusé | ✅ exécuté | Privilèges |
| T9 | `UPDATE` audit par le rôle applicatif → refusé | ✅ exécuté | Privilèges |
| T10 | Direction sans MFA → aucun jeton | ✅ exécuté (HTTP) | API |
| T10b | 6 échecs de connexion → verrouillage | ✅ exécuté (HTTP) | API |
| T11 | Refresh rejoué → session révoquée | ✅ exécuté (HTTP) | API |
| T12 | Rôle insuffisant → 403 | ✅ exécuté (HTTP) | API |
| T13 | Requête métier hors `TenancyService` → refusée | ⬜ à outiller (grep CI) | Statique |

**Reproductibilité :** deux scripts, sans jamais toucher la base de développement.

```powershell
cd apps\api
$env:SEED_PASSWORD = "un-mot-de-passe-de-test"
powershell -ExecutionPolicy Bypass -File .\test\db\run-db-tests.ps1
powershell -ExecutionPolicy Bypass -File .\test\api\run-api-tests.ps1
```

---

## 4. Définition de « terminé » pour le Lot 1

1. ✅ `migration.sql` s'applique sur une base vide sans erreur.
2. ✅ `010_rls.sql` s'applique deux fois de suite sans erreur (idempotence).
3. ✅ Le seed s'exécute deux fois et produit exactement les mêmes compteurs.
4. ✅ Les tests T1 à T3 et T5 passent avec le rôle applicatif (SQL **et** HTTP).
5. ✅ Aucune table métier sans `schoolId` + policy + `FORCE RLS`.
6. ✅ Documentation à jour (avenant, ADR, plan, guide, tests).

**Reste à faire pour clore le lot :** module `activation`, module `schools`, console web.

---

## Jalon du 29 octobre 2026 — activation et abonnements

Livre et verifie par execution :

- schema Subscription (statut trial par defaut, 120 DH/enfant/an parametrable) ;
- School.code (6 caracteres) pour le rattachement des familles ;
- module d'activation : parent par code ecole + code eleve, invitation nominative,
  validation d'ecole par le super-admin ;
- regle « aucun droit avant activation » : ecole en attente = connexion refusee (403),
  activation refusee, et changement de profil sans elevation de privileges sans MFA ;
- T13 : controle statique test/static/check-tenancy.mjs.

Tests executes :

```
API : 54 / 54
  + gate ecole en attente (403)
  + activation parent (201 + jetons), second responsable accepte, troisieme refuse (409)
  + invitation creee par la direction, role direction refuse (400),
    enseignant non autorise (403), invitation acceptee, reutilisation refusee (401)
  + super-admin : MFA, validation d'ecole, connexion debloquee ensuite
Base : 8 / 8 (T1, T2, T3, T5, T6, T7, T8, T9) + seed idempotent
Statique : T13 OK (34 fichiers) et detecte une violation volontaire (test negatif)
Policies RLS : 13
Derive de schema : aucune (comparaison base neuve / schema Prisma)
```

Migrations : les deux migrations intermediaires ont ete consolidees en une seule avant
toute mise en production (base neuve, aucune donnee reelle). La migration consolidee
fait 335 lignes et ne produit aucune derive.

---

## Jalon du 29 octobre 2026 — console web (cloture du Lot 1)

`apps/web` est livre : Next.js 16 + React 19, theme CDC §14, quatre ecrans branches
sur l'API reelle.

| Ecran | Route | Verification |
|---|---|---|
| Connexion + second facteur | `/login` | HTTP 200, contenu ORYA, parcours mot de passe -> defi -> code |
| Tableau de bord + selecteur de profil | `/dashboard` | HTTP 200, profil actif, statut ecole, MFA |
| Ecoles (super-admin) | `/schools` | HTTP 200, creation + validation branchees |
| Journal d'audit | `/audit` | HTTP 200, 100 derniers evenements |

Verifications executees :

```
Build Next : 6 routes statiques (/ /login /dashboard /schools /audit /_not-found)
Console    : GET /login -> 200, GET /dashboard|/schools|/audit -> 200
CORS       : preflight OPTIONS -> 204, Access-Control-Allow-Origin: http://localhost:3000
Login reel : POST /api/v1/auth/login -> 200 {"mfaRequired":true,"method":"verify"}
Tests API  : 56 / 56
Tests base : 8 / 8 + seed idempotent
T13        : OK (34 fichiers)
```

Limites assumees et documentees :

1. jetons en `sessionStorage` (cible : cookies httpOnly + BFF) ;
2. wordmark officiel ORYA non encore livre (aucun substitut graphique) ;
3. **le port 3001 est deja occupe sur cette machine par une autre application** :
   l'API doit etre lancee sur un port libre (`API_PORT`) et la console doit recevoir
   `NEXT_PUBLIC_API_BASE` en consequence, avant `npm run build`.

---

## Jalon du 29 octobre 2026 — durcissement de l'activation et anti-rejeu

- **Codes d'activation longs et expirants** : `Student.activationCodeHash` (SHA-256),
  `activationCodeIssuedAt`, `activationCodeExpiresAt`. Le `studentCode` n'est plus un
  secret. Emission par la direction : `POST /students/:id/activation-code` (1 a 365
  jours, 30 par defaut), auditee.
- **Verrouillage des tentatives** : `AttemptThrottleService` (par IP et par endpoint),
  10 echecs / 15 min, puis 429 pendant 15 min ; un succes remet le compteur a zero.
- **Audit des echecs** : `activation.parent.failed` et `activation.invitation.failed`
  ecrits dans le journal de l'ecole (code inconnu, expire, invitation invalide).
  Sans ecole identifiable, la trace reste dans les journaux serveur.
- **Anti-rejeu TOTP** : `User.mfaLastStep` memorise le dernier pas consomme ; un code
  deja utilise est refuse et audite (`auth.mfa.replay_blocked`). Tolerance de +/-1 pas
  pour eviter les refus a la frontiere des 30 s.
- **Controles statiques en CI** : `npm run test:static` = T13 (isolation) +
  `check-encoding.mjs` (BOM interdit, double encodage, scripts PowerShell ASCII).
  Pipeline : `.github/workflows/ci.yml` (api : prisma validate, tsc, test:static ;
  web : build).
- **Console** : ecran `/pending` (acces en attente de validation) et redirection
  automatique de tout etablissement non valide.

Verifications executees :

```
Tests API : 61 / 61
  + code d'activation emis par la direction (201), long (>= 32 caracteres)
  + code invalide refuse (404), activation valide, 2e responsable, 3e refuse (409)
  + verrouillage apres echecs repetes (429)
  + anti-rejeu : la 2e connexion du meme compte exige un nouveau pas TOTP
Tests base : 8 / 8 + seed idempotent
test:static : T13 OK (36 fichiers) + encodage OK (85 fichiers)
Migrations : 2 migrations appliquees dans l'ordre, aucune derive
Build : API et console OK (7 routes, dont /pending)
```

Fichiers detectes par le controle d'encodage et corriges : `auth.controller.ts`
(BOM + caracteres de double encodage), `grant-test-role.sql` (BOM), et le controle
lui-meme (faux positif sur ses propres sequences).
