# ORYA — Roadmap de finalisation

Feuille de route unique. Statuts : **À faire**, **En cours**, **Développé** (code écrit, non vérifié de bout en bout), **Testé** (tests automatisés exécutés et verts), **Validé** (réservé à Ayoub, après recette).

Dernière mise à jour : 30 octobre 2026 (UTC), branche locale `feature/lot-6-agenda-homework`.

## Socle déjà livré

| Élément | Statut |
|---|---|
| Lot 1 : authentification, MFA, rôles, multi-écoles + RLS, audit, invitations, appareils | Testé |
| Lot 2.1 : import élèves CSV/XLSX, prévisualisation, erreurs par ligne, préservation Massar | Testé |
| Lot 2.2 : API présences (affectations, sessions, marquage, clôture/réouverture) | Testé |

## Lot 2.3 — Interface web des présences

| Fonctionnalité | Statut |
|---|---|
| Endpoints de lecture : classes, enseignants, sessions par classe/date, historique | Testé |
| Liste des classes (direction : toutes ; enseignant : les siennes) | Testé (API) ; UI développée |
| Affectation des enseignants (UI) | Développé |
| Sélection de la date et du créneau matin/après-midi | Développé |
| Liste des élèves, marquage individuel et collectif, enregistrement + confirmation | Développé |
| Clôture, réouverture avec motif (direction) | Testé (API) ; UI développée |
| Historique des modifications par élève | Testé (API) ; UI développée |
| Gestion des erreurs API (400/401/403/404/409/413/429/réseau) | Développé |
| Responsive mobile et ordinateur | Développé |
| CSP et en-têtes de sécurité web | Testé (vérifié sur `next start`) |
| Protection contre l'injection de formules à l'import, signature XLSX | Testé |
| FK RESTRICT sur les présences (migration non destructive) | Testé |
| Tests E2E navigateur de l'UI | Parcours clés couverts (lot 10) |

## Lot 3 — Élèves et familles

Détails : `docs/lot3-students-families.md`.

| Fonctionnalité | Statut |
|---|---|
| Liste élèves (recherche, filtre classe, sans classe) | Testé (API) ; UI développée |
| Fiche élève : informations scolaires, modification, code Massar | Testé (API) ; UI développée |
| Affectation et changement de classe (tracé dans l'historique) | Testé (API) ; UI développée |
| Historique de l'élève (journal d'audit) et résumé des présences | Testé (API) ; UI développée |
| Responsables légaux : création, modification, coordonnées (2 téléphones, e-mail, adresse) | Testé (API) ; UI développée |
| Lien responsable-élève, plusieurs enfants, maximum 2 responsables | Testé (API) ; UI développée |
| Import des responsables CSV/XLSX (2.1b), même pipeline et protections | Testé (API) ; UI développée |
| Invitation parent liée au responsable, activation, rattachement automatique | Testé (API) ; UI développée |
| Page publique d'activation (lien d'invitation ou code école + code d'activation) | Développé |
| Espace parent minimal « Mes enfants » limité à ses enfants | Testé (API, autorisations) ; UI développée |
| Tests E2E navigateur | Parcours clés couverts (lot 10) |

## Lot 4 — Espace parents

Détails : `docs/lot4-parent-space.md`.

| Fonctionnalité | Statut |
|---|---|
| Enfants du parent uniquement, présences, retards, absences (justifiées ou non) | Testé (API, autorisations) ; UI développée |
| Envoi de justificatif avec pièce jointe (PDF/JPEG/PNG, taille, magic bytes) | Testé (API) ; UI développée |
| Stockage privé : `StorageService`, pilote local hors racine web, flux API autorisé | Testé (API) |
| Pilote S3 compatible | Interface documentée, non implémentée (aucun service payant) |
| Examen par l'école : accepter / refuser avec motif, audit, historique élève | Testé (API) ; UI développée |
| Notifications in-app (liste, non lues, marquer lu) | Testé (API) ; UI développée |
| Actions demandées par l'école, signalées faites par le parent | Testé (API) ; UI développée |
| Agenda, devoirs, communications | À faire (lots 5 et 6 : aucun backend, rien d'affiché) |
| Rétention et chiffrement au repos des justificatifs | À faire (lot 10, avec le pilote S3) |
| Tests E2E navigateur | Parcours clés couverts (lot 10) |

## Lot 5 — Communication école-famille

Détails : `docs/lot5-communication.md`.

| Fonctionnalité | Statut |
|---|---|
| Annonces et événements (toute l'école ou une classe) | Testé (API) ; UI développée |
| Messages de classe (enseignant : ses classes seulement) | Testé (API, autorisations) ; UI développée |
| Échanges individuels école-famille avec historique des réponses | Testé (API) ; UI développée |
| Messages importants, accusés de lecture et de réception, suivi par parent | Testé (API) ; UI développée |
| `NotificationChannel` : in-app réel ; e-mail / SMS / WhatsApp « non configuré » (aucun envoi simulé) | Testé (API) |
| Notification in-app automatique des parents à la clôture d'un appel (absent/retard), sans doublon | Testé (API) |
| Fournisseurs e-mail / SMS / WhatsApp réels | À faire (service payant : validation d'Ayoub requise) |
| Tests E2E navigateur | Parcours clés couverts (lot 10) |

## Lot 6 — Agenda et devoirs

Détails : `docs/lot6-agenda-homework.md`.

| Fonctionnalité | Statut |
|---|---|
| Agenda de classe : devoirs, contrôles, événements de classe | Testé (API) ; UI développée |
| Dates importantes d'école (direction) | Testé (API) ; UI développée |
| Calendrier des événements d'école : réutilise les événements du lot 5, sans duplication | Testé (API) ; UI développée |
| Publication par l'enseignant affecté ou la direction, échéances | Testé (API, autorisations) ; UI développée |
| Pièces jointes privées (StorageService du lot 4), 3 maximum | Testé (API) ; UI développée |
| Vue parent limitée aux classes de ses enfants | Testé (API, isolation) ; UI développée |
| Historique des modifications (audit avant / après), annulation | Testé (API) ; UI développée |
| Notification in-app des devoirs et contrôles | Testé (API) |
| Correction : « Mes enfants » ne s'allume plus sur Messages / Agenda | Développé |
| Pièces jointes aux messages (lot 5) | À faire (non incluses : coût supérieur à « si peu coûteux ») |
| Tests E2E navigateur | Parcours clés couverts (lot 10) |

## Lot 7 — Tableau de bord direction

Détails : `docs/lot7-dashboard.md`.

| Fonctionnalité | Statut |
|---|---|
| Nombre d'élèves, effectifs par classe (année en cours) | Testé (API) ; UI développée |
| Appel du jour : séances ouvertes / clôturées, présents, absents, retards, classes sans appel | Testé (API) ; UI développée |
| Absences et retards non justifiés (hors justificatif accepté couvrant la date) | Testé (API) ; UI développée |
| Activité des enseignants : appels, agenda/devoirs, messages publiés | Testé (API) ; UI développée |
| Communications : envois par type, taux de lecture et d'accusé | Testé (API) ; UI développée |
| Justificatifs et actions familles en attente (dont en retard) | Testé (API) ; UI développée |
| Indicateurs par jour sur une période (≤ 92 jours), états vides sans chiffre inventé | Testé (API) ; UI développée |
| Exports CSV/XLSX (6 rapports), échappement anti-formule, audit `dashboard.exported` | Testé (API) ; UI développée |
| Direction uniquement + MFA, isolation entre écoles, index dédiés | Testé (API) |
| Tests E2E navigateur, graphiques avancés | E2E faits (lot 10) ; graphiques ultérieurs |

## Lot 8 — Préparation Massar et exports

Détails : `docs/lot8-massar-exports.md`. Aucune connexion officielle à Massar : exports « format ORYA compatible pour saisie Massar », colonnes supposées, configurables, à vérifier avec une vraie école.

| Fonctionnalité | Statut |
|---|---|
| Contrôle des champs obligatoires (code Massar, date de naissance, classe de l'année, nom complet) | Testé (API) ; UI développée |
| Contrôle des identifiants : format configurable, doublons (insensibles à la casse), doublons probables d'élèves | Testé (API) ; UI développée |
| Préservation des codes Massar : un import ne remplace jamais un code existant | Testé (API) |
| Exports CSV/XLSX : élèves, inscriptions, absences par période, totaux par élève, anomalies | Testé (API) ; UI développée |
| Échappement anti-formule, notice « À lire » dans le XLSX | Testé (API) |
| Historique des exports (table `MassarExport` + AuditLog `massar.exported`, empreinte SHA-256) | Testé (API) ; UI développée |
| Direction + MFA, isolation entre écoles (RLS) | Testé (API) |
| Validation des colonnes avec une école réelle | À faire (Ayoub / école pilote) |

## Lot 9 — Abonnements et administration SaaS

Détails : `docs/lot9-saas-admin.md`. Aucun prix inventé, aucun paiement réel.

| Fonctionnalité | Statut |
|---|---|
| Console super-admin : écoles, abonnements, usage réel (élèves, personnel, parents, messages, appels, stockage, dernière activité) | Testé (API) ; UI développée |
| Accès inter-écoles uniquement via le contexte super-admin explicite (rôle + MFA), consultations et changements audités | Testé (API) |
| RLS renforcée : abonnement, factures, instantanés en lecture seule pour l'école (écriture super-admin) | Développé et testé (L9-1 à L9-8) |
| Plans configurables ; 3 plans placeholders « à définir » (limites et prix null) | Testé (API) ; UI développée |
| Statuts trial / active / past_due / suspended / cancelled, transitions contrôlées, motif obligatoire | Testé (API) ; UI développée |
| Limites : élèves (import) et comptes personnel (invitations) → 402 `PLAN_LIMIT_REACHED` | Testé (API) |
| Établissement suspendu / résilié / expiré → lecture seule 403 `SUBSCRIPTION_INACTIVE` ; essai terminé → 402 `TRIAL_EXPIRED` | Testé (API) |
| Suivi d'usage (instantanés `UsageSnapshot`) | Testé (API) ; UI développée |
| Préparation facturation : modèle `Invoice` (brouillons, montant null si prix à définir), `BillingProvider` « Non configuré » (503) | Testé (API) ; UI développée |
| Vue direction « Abonnement » (son école uniquement) | Testé (API) ; UI développée |
| Choix des plans, limites, prix et du fournisseur de paiement | À décider (Ayoub) |

## Lot 10 - Finalisation et lancement

Détail : `docs/lot10-launch.md`.

| Fonctionnalité | Statut |
|---|---|
| Tests SQL RLS lot 9, E2E Playwright (prof, parent mobile, direction) | Développé et testé |
| Cookies httpOnly + CSRF, npm audit (correctifs non majeurs) | Développé et testé |
| États erreur/chargement, sauvegarde/restauration, démo, guides, checklist pilote | Développé et testé localement |
| Préparation déploiement (Dockerfiles, compose exemple) | Préparé, non construit ni déployé |
| Montée Prisma 7, test de charge, audit responsive complet | À faire (lot dédié) |

## Estimation indicative par lot

Hypothèse : même rythme de livraison (agent + revue d'Ayoub), hors attente de validation et de fournisseurs externes. Fourchettes en jours-développeur (équivalent d'un développeur humain). Lot 10 livré localement ; reste : mise en ligne et dette technique.

| Lot | Estimation | Principales incertitudes |
|---|---|---|
| 7 — Tableau de bord direction | Développé et testé (≈ 1,5 j équivalent) | Validation des indicateurs |
| 8 — Préparation Massar et exports | Développé et testé (≈ 2 j équivalent) | Colonnes à confirmer avec une école |
| 9 — Abonnements et administration SaaS | Développé et testé (≈ 2,5 j équivalent) | Plans, prix, fournisseur de paiement à décider |
| 10 — Finalisation et lancement | 4 à 6 j | Playwright, cookies httpOnly/BFF, Prisma 7, déploiement, sauvegardes |
| **Total restant** | **~ 2 à 4 j + recette pilote** | |

## Préparation mise en production (3 nov. 2026)

Vérifications locales sur e018619 : API 358/358, tests DB verts, E2E 4/4, build API + web OK, migrations sur base neuve `orya_migcheck` OK (RLS 18 tests OK). Checklist : `docs/CHECKLIST_MISE_EN_PRODUCTION.md`. Points ouverts : jeton d'accès valide jusqu'à expiration après déconnexion (15 min), menu direction qui déborde en tablette/bureau, pas de lint web (`next lint` retiré dans Next 16), Dockerfiles jamais construits.

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

## Backlog issu de l'étape 2 (P0-2, 4 nov. 2026)

- **P1 — durcir scripts/restore-db.ps1** : refuser toute restauration dans une base existante non vide sans un paramètre de confirmation contenant le nom exact de la base (ex. `-ConfirmTarget <nom>`) ; `-Recreate` seul ne suffit plus.
- **P2 — bruit des NOTICE sous Windows PowerShell 5.1** : avec `*>&1` (ou `2>&1`) et `$ErrorActionPreference = 'Stop'`, le premier `NOTICE` de psql sur stderr devient une erreur bloquante (`NativeCommandError`). Passer `-q` / `SET client_min_messages = warning` dans les scripts, ou lancer les suites avec `powershell -File` sans redirection interne.

- **P1 — fonctions dédiées d'écriture des secrets de `User`** (suite P0-3) : `orya_auth_set_password(user_id, hash)`, `orya_auth_enroll_mfa(user_id, secret_chiffré)` et `orya_auth_reset_password(jeton, hash)` en SECURITY DEFINER (propriétaire `orya_auth`, `search_path = pg_catalog, pg_temp`, EXECUTE à `orya_app` seul), puis `REVOKE UPDATE ("passwordHash", "mfaSecret") ON "User" FROM orya_app` et création de compte (INSERT) par fonction. Tests : `has_column_privilege(... 'UPDATE')` = false ; changement de mot de passe, enrôlement MFA et réinitialisation toujours verts.
