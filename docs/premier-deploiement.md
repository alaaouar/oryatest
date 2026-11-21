# Premier déploiement ORYA : base, propriétaire, migrations (P0-8)

Procédure de la toute première mise en place d'une base de production. Aucun mot de passe
n'apparaît ici, ni dans l'historique du shell : utilisez `\password` dans psql.

## Rôles

| Rôle | Connexion | Usage |
|---|---|---|
| administrateur PostgreSQL (fourni par l'hébergeur) | oui | étapes 1 et 2 uniquement |
| `orya_owner` | oui, NOSUPERUSER, BYPASSRLS | propriétaire de la base, des tables, des policies ; job `migrate` |
| `orya_app` | oui, NOBYPASSRLS | runtime API (`DATABASE_URL`), soumis au RLS |
| `orya_auth` | NOLOGIN | propriétaire des deux fonctions SECURITY DEFINER d'authentification |

## 1. Base et rôles (administrateur, une seule fois)

```sql
-- connecté à la base "postgres" en administrateur
CREATE DATABASE orya;
\c orya
\i apps/api/prisma/sql/000_roles.sql      -- crée orya_owner, orya_app, orya_auth (idempotent)
ALTER DATABASE orya OWNER TO orya_owner;
ALTER SCHEMA public OWNER TO orya_owner;
\password orya_owner
\password orya_app
```

`000_roles.sql` contient des `ALTER ROLE` : il doit être exécuté par l'administrateur, jamais
par `orya_owner` (qui est NOCREATEROLE).

## 2. Contrôle avant migration

```sql
SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database();  -- orya_owner
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname LIKE 'orya_%';
```

## 3. Migrations (job `migrate`, rôle `orya_owner`)

Image `orya-api-migrate:<sha12>` (voir `scripts/build-images.ps1`). Variables :
`DIRECT_DATABASE_URL` = connexion `orya_owner` ; `DATABASE_URL` = connexion `orya_app` (différente) ;
**`APPLY_ROLES=0`** (les rôles sont déjà créés à l'étape 1 ; l'image a `APPLY_ROLES=1` par défaut
pour les environnements où l'administrateur lance lui-même le job).

Le job exécute `prisma migrate deploy` puis `010_rls.sql` dans une transaction. Les tables et
policies appartiennent donc à `orya_owner`, et les fonctions d'authentification sont transférées à
`orya_auth` (`orya_owner` est membre de `orya_auth` et `orya_auth` a CREATE sur `public`).

## 4. Test de propriété (bloquant, automatique)

Le déploiement échoue si les fonctions `orya_auth_credentials(text)` et `orya_auth_mfa_state(uuid)`
n'appartiennent pas à `orya_auth` :

- `010_rls.sql` : `ALTER FUNCTION ... OWNER TO orya_auth` lève une exception si le rôle manque,
  puis un bloc `DO` vérifie le propriétaire et lève une exception sinon ;
- `apply-sql.ts` revérifie après la transaction et sort en code 1 ;
- test négatif : `apps/api/test/db/verify-auth-owner-negative.sql` (suite DB).

Contrôle manuel complémentaire :

```sql
SELECT p.proname, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
FROM pg_proc p WHERE p.proname IN ('orya_auth_credentials', 'orya_auth_mfa_state');
-- attendu : orya_auth, true, {"search_path=pg_catalog, pg_temp"}
SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'public';  -- orya_owner seul
```

## 5. Démarrage de l'API

`orya-api:<sha12>` avec `DATABASE_URL` (`orya_app`) seulement. Pas de seed en production : les
images ne contiennent ni `seed.ts` ni SQL de démo (P0-7).

## 6. Premier super-administrateur (sans seed)

Outil en ligne de commande, connecté en `orya_owner` (`DIRECT_DATABASE_URL`), lancé dans un
terminal interactif :

```powershell
# poste d'exploitation (apps/api)
npm run admin:create-super-admin -- --email=admin@<domaine> --name="Super-admin ORYA"
# ou depuis l'image migrate (-it obligatoire pour la saisie masquee ; jamais echo | docker ...)
docker run -it --rm -e DIRECT_DATABASE_URL orya-api-migrate:<sha12> node migrate/create-super-admin.js --email=admin@<domaine>
```

- Le mot de passe est saisi deux fois, en saisie masquée. Il n'est jamais accepté en paramètre
  (tout argument contenant « pass », « pwd », « secret » ou « mdp » est refusé), jamais affiché
  ni journalisé.
- **INTERDIT** : saisir le mot de passe avec `echo`, une redirection, une variable d'environnement,
  un argument, un fichier, un presse-papiers partagé, ou toute commande qui laisse le secret dans
  l'historique du shell (`echo ... | npm run ...`, `$env:PWD=...`). Uniquement la saisie masquée
  interactive du terminal (`-it` sous Docker). Le mode tube (`ORYA_BOOTSTRAP_STDIN=1`) est réservé
  aux tests automatisés ; il ne doit jamais être utilisé en production ni sur une machine
  d'exploitation.
- Politique : 12 à 128 caractères, au moins 3 familles (minuscules, majuscules, chiffres,
  symboles), sans l'identifiant de l'e-mail.
- Le compte est créé sans MFA : la première connexion renvoie `mfaRequired` avec
  `method = enroll`, l'enrôlement TOTP est donc imposé avant toute session.
- L'action est auditée (`AuditLog` « admin.super_admin.bootstrap », sévérité critical).
- L'outil refuse (code 3) s'il existe déjà un super-administrateur ; contrôle refait sous
  verrou dans la transaction.
- Mode test uniquement : hors terminal, l'outil refuse, sauf `ORYA_BOOTSTRAP_STDIN=1`, qui lit
  les deux saisies sur l'entrée standard (tube). Réservé aux tests automatisés ; le mot de passe
  ne passe jamais dans argv.

## 7. Proxy de confiance : `TRUST_PROXY_HOPS`

L'API lit l'IP du client dans `X-Forwarded-For` en ne faisant confiance qu'aux
`TRUST_PROXY_HOPS` derniers sauts (entier 0 à 5, défaut 1 ; toute autre valeur bloque le
démarrage). Cette IP sert à la limite de débit et au verrouillage de connexion : une valeur trop
haute permet à un client de forger son IP, une valeur trop basse fait partager une seule limite à
tous les utilisateurs (l'IP du proxy).

**La valeur exacte dépend de l'hébergement et doit être fixée avant l'ouverture :**

| Chaîne devant l'API | Valeur |
|---|---|
| API exposée directement, sans proxy | 0 |
| Un reverse proxy (Caddy ou Nginx du compose) | 1 |
| CDN ou load balancer + reverse proxy | 2 |
| Chaque proxy supplémentaire qui ajoute une entrée à `X-Forwarded-For` | +1 |

Comment la déterminer :
1. lister les équipements entre Internet et le conteneur API (documentation de l'hébergeur :
   load balancer, CDN, ingress) ;
2. vérifier : appeler l'API depuis une IP connue et lire, dans le journal d'audit d'une connexion,
   le champ `ip` ; il doit être l'IP publique du poste de test, ni celle d'un proxy ni une valeur
   forgée ;
3. contre-test : refaire l'appel avec un en-tête `X-Forwarded-For: 203.0.113.99` ajouté par le
   client ; l'IP journalisée ne doit pas devenir 203.0.113.99.

Si un proxy n'ajoute pas d'entrée (mode TCP pur), il ne compte pas. Reporter la valeur retenue et
la preuve du contrôle dans la fiche de mise en production.

## Rejeu automatisé

`scripts/test-first-deploy.ps1` rejoue les étapes 1 à 6 sur un conteneur jetable vierge
(`orya-test-fd`, 127.0.0.1:55434, label created-by=orya-test, supprimé dans un `finally`) :
rôles par l'administrateur, migration et `010_rls.sql` en `orya_owner`, contrôles de propriété,
rejeu idempotent du job avec `APPLY_ROLES=1`, outil super-administrateur (refus et création),
puis connexion API qui impose l'enrôlement MFA. Étape « Premier deploiement » de `verify-all.ps1`.
