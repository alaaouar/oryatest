# Pré-production ORYA — définition et runbook (t62u B1)

> Rédigé le 12/11/2026. **Rien n'est déployé** : ce document décrit l'environnement à monter et
> les contrôles à exécuter. Aucune valeur réelle (secret, domaine, identifiant) n'est dans le dépôt.
> Les cases **[DÉCISION]** demandent un choix d'Ayoub.

## 1. Rôle et règles
- Environnement **séparé** de la production : serveur (ou projet Docker) `orya-preprod`, base
  `orya_preprod`, buckets, clés et comptes propres. Aucun secret partagé avec la production.
- **Aucune donnée réelle** : école, élèves, parents et comptes de fumée **fictifs**.
- Même image que la production (même SHA de commit), seule la configuration change.
- Fichiers fournis : `deploy/docker-compose.preprod.example.yml`, `deploy/env.preprod.example`.

## 2. Prérequis
- [ ] **[DÉCISION]** Hébergeur, région (loi 09-08 / CNDP) et sous-domaines (`app.preprod.…`, `api.preprod.…`).
- [ ] Serveur Linux + Docker Compose, pare-feu 80/443, reverse proxy TLS (HSTS) devant `web` et `api`.
- [ ] **[DÉCISION]** Fournisseur S3 (ou compatible) proposant **Object Lock en mode conformité**.

## 3. Stockage des fichiers (bucket `__bucket_fichiers_preprod__`)
- [ ] Bucket privé, Block Public Access, **chiffrement par défaut** activé (SSE-S3 ou SSE-KMS).
  Le pilote envoie toujours l'en-tête SSE, mais le harnais a montré qu'un S3 compatible peut
  accepter une écriture sans chiffrement si le défaut n'est pas configuré.
- [ ] Identifiants dédiés limités à ce bucket (Get/Put/Delete/HeadObject), jamais ceux du journal WORM.
- [ ] Harnais fournisseur (sur le poste d'exploitation, variables `STORAGE_S3_*` de pré-production
  saisies dans la session, jamais en argument) :
  `powershell -ExecutionPolicy Bypass -File .\scripts\test-s3-provider.ps1`
  Attendu : `S3PROVIDER : 15 OK, 0 KO` (SSE, URL pré-signée et en-têtes, expiration, refus sans
  signature / signature altérée / autre clé / mauvais secret / liste et écriture anonymes,
  suppression). La ligne `S3P INFO` indique si une écriture sans en-tête SSE est chiffrée par défaut.

## 4. Journal des suppressions WORM (bucket `__bucket_journal_worm_preprod__`)
1. Créer le bucket **avec Object Lock** (impossible à ajouter après coup chez la plupart des
   fournisseurs) ; versioning actif.
2. Rétention par défaut **COMPLIANCE**, durée = **[DÉCISION]** (au moins la durée de conservation
   des sauvegardes ; à valider par le juriste). En pré-production : courte (ex. 1 jour), le mode
   conformité rendant les objets indestructibles jusqu'à échéance, même pour le compte racine.
3. Trois jeux d'identifiants distincts :
   - **écriture seule** (API) : `s3:PutObject` sur `deletion-journal/v1/*`, rien d'autre ;
     dans `.env.preprod` (`DELETION_JOURNAL_WORM_WRITER_*`) ;
   - **lecture seule** (rejeu) : `s3:GetObject`, `s3:GetObjectVersion`, `s3:GetObjectRetention`,
     `s3:ListBucket`, `s3:ListBucketVersions` ; **coffre de l'exploitant**, jamais sur le serveur ;
   - **administrateur** du bucket : hors ligne, jamais utilisé par ORYA.
4. À chaque anonymisation, l'API refuse des identifiants WORM égaux à `STORAGE_S3_*`,
   un bucket égal à celui des fichiers, ou écriture = lecture. Avec `NODE_ENV=production`, une
   anonymisation sans WORM configuré est **refusée** (`DELETION_JOURNAL_WORM_REQUIRED=0` seulement
   pour un environnement sans journal, jamais en production).
5. Contrôles chez le fournisseur (identifiants d'écriture) : lecture et liste refusées (403),
   suppression d'une version refusée, écrasement refusé (412) ; avec l'administrateur : suppression
   d'une version, contournement de gouvernance et rétention raccourcie refusés. Prouvé localement
   sur SeaweedFS jetable par `BLOC6 W0-W14` ; **à refaire chez le fournisseur retenu**.

## 5. Déploiement
1. `scripts/build-images.ps1` sur le commit validé (`ORYA_IMAGE_TAG` = SHA), image web construite
   avec `PUBLIC_API_BASE` de pré-production.
2. Copier les deux fichiers d'exemple, remplir `deploy/.env.preprod` (secrets générés sur place :
   `JWT_ACCESS_SECRET` 48 octets hex, `MFA_ENCRYPTION_KEY` et `DELETION_REGISTER_HMAC_KEY`
   32 octets base64, sauvegardés dans le coffre).
3. `docker compose -f docker-compose.preprod.yml --env-file .env.preprod up -d` : postgres et
   clamav sains → `migrate` termine → `api` saine → `web`.
4. Créer le super-admin (`create-super-admin`, cible `migrate`, saisie interactive `-it`, voir `docs/premier-deploiement.md`).
5. Données fictives par le parcours normal : école « École pré-production (fictive) » validée par
   le super-admin, import fictif, activation de deux parents de fumée (adresses de test).
   Le compte « suppression » est **consommé** à chaque passage (désactivé, anonymisé à J+14) :
   en prévoir un neuf par passage.

## 6. Test de fumée
Variables dans la session (jamais en argument) : `ORYA_SMOKE_EXPORT_EMAIL`, `ORYA_SMOKE_EXPORT_PASSWORD`,
`ORYA_SMOKE_DELETE_EMAIL`, `ORYA_SMOKE_DELETE_PASSWORD` (et `_TOTP_SECRET` si MFA), puis :
`powershell -ExecutionPolicy Bypass -File .\scripts\preprod-smoke.ps1 -BaseUrl https://api.preprod.…/api/v1`
depuis un poste au commit déployé (les migrations attendues sont lues dans `apps/api/prisma/migrations`).
Attendu : `SMOKE : 19 OK, 0 KO` — HTTPS, `/health` et migrations appliquées = commit déployé
(nombre + empreinte, via `orya_migrations_state()`), connexion, export JSON/PDF, suppression
(session révoquée, reconnexion refusée). Validé localement par `BLOC6 S0-S6`.

## 7. Exercice de restauration (obligatoire avant ouverture)
1. Sauvegarde (`scripts/backup-db.ps1`), puis restauration dans une base neuve.
2. Rejeu **sans** le fichier local : identifiants de **lecture** WORM saisis dans la session
   (`DELETION_JOURNAL_WORM_READER_*`, + `DATABASE_URL`, `DELETION_REGISTER_HMAC_KEY`,
   `DELETION_JOURNAL_WORM_BUCKET/REGION`), `scripts/restore-db.ps1 … -Replay`.
   Attendu : `sources.worm.entries` = nombre de suppressions, aucun compte supprimé ne réapparaît.
   Un fichier local altéré est signalé (`sources.local = "altere"`) et la copie WORM fait foi.

## 8. Critères de sortie de pré-production
- [ ] `scripts/verify-all.ps1` vert sur le commit déployé (journal joint).
- [ ] Harnais S3 vert chez le fournisseur ; contrôles WORM du §4.5 faits chez le fournisseur.
- [ ] Test de fumée vert sur l'URL de pré-production.
- [ ] Exercice de restauration + rejeu WORM réussi.
- [ ] Points ouverts relus : voir `docs/CHECKLIST_MISE_EN_PRODUCTION.md` (rétractation de
  suppression, activation pendant suspension, arabe à relire, validations juriste et comptable).
