# ORYA — Rapport général d'avancement et de maturité technique

**Audit indépendant et factuel, en trois temps (A : inventaire ; B : tests ; C : rapport).** Rédigé le 3 novembre 2026 (UTC).

**Référence fonctionnelle :** « ORYA Complète — Cahier des charges final, Version 2.0, Octobre 2026 ». La copie utilisée est `C:\Users\YEP\Desktop\ORYA FINAL CDC.docx`, car **le fichier n'est pas dans le dépôt** (`docs/CDC_ORYA_v2.md` est absent et ne figure dans aucun commit).

**Avenant n°1**, tel que formulé par Ayoub dans la conversation d'audit le 3/11/2026 :
- tarif de 100 DH HT, soit 120 DH TTC, par enfant ;
- l'école collecte auprès des parents et paie ORYA par un virement unique : il n'y a plus de paiement en ligne parent ni de prestataire de paiement ;
- un profil Accompagnateur unique, qui inclut le chauffeur ;
- une politique d'accès élève identique à tous les niveaux (tous les élèves sont mineurs, consentement parental requis).

Le dépôt contient aussi `docs/avenant-cdc-v1.md` (29/10/2026). Son contenu diffère : il classe le paiement « hors V1 / reporté » et présente l'accompagnateur sur mobile Flutter comme « à confirmer ». **C'est la formulation donnée en conversation qui fait foi ici** (voir le registre des contradictions).

**Portée des résultats :**
- Les tests portent sur l'**arbre de travail local** de `C:\Users\YEP\Projects\orya`, branche `feature/lot-10-launch`, HEAD `e018619`, **avec les 17 fichiers modifiés non commités et les fichiers non suivis**.
- Ils ne valent **ni pour un commit propre, ni pour `main`** (`4f33117`), ni pour une version fusionnée.

**Bases historiques :** les bases `orya` et `orya_v2` **n'ont été ni inspectées ni ciblées** par aucune commande de l'audit. Leur intégrité **n'est pas vérifiée**.

**Distinction obligatoire entre deux types de preuves :**
- les « **vérifications de l'audit** » : scripts écrits et exécutés par l'auditeur dans un environnement isolé ;
- les « **suites du dépôt** » : `run-api-tests.ps1`, `run-db-tests.ps1`, `run-e2e.ps1`. **Elles n'ont pas pu être exécutées sans risque** et restent NON TESTÉES.

Seule exception : les specs Playwright du dépôt ont été lancées directement, sans le wrapper.

**Statuts utilisés (exclusivement) :** TERMINÉ ET TESTÉ · DÉVELOPPÉ NON TESTÉ · PARTIEL · DOCUMENTÉ SEULEMENT · ABSENT · À VÉRIFIER MANUELLEMENT.
- **TERMINÉ ET TESTÉ** signifie : testé avec succès au temps B, sur données fictives, dans l'environnement isolé, sur l'arbre de travail. **Cela ne veut pas dire « prêt pour la production ».**

---

## 1. Résumé exécutif
1. ORYA dispose d'une **console web et d'une API fonctionnelles** pour le cœur scolaire. Sur l'arbre de travail, j'ai testé avec succès l'appel, les justificatifs, les messages, l'agenda, l'import, l'export Massar, le tableau de bord et le super-admin.
2. **L'isolation entre écoles (RLS) et l'authentification** (MFA, rotation et détection de rejeu des jetons, cookies httpOnly + CSRF, révocation au logout) **ont été vérifiées en exécution** par l'audit.
3. **Une part importante du CDC est absente :** application mobile, espace élève, transport scolaire, notifications push, mode hors-ligne, facturation école (selon l'Avenant n°1), conformité intégrée (CGU FR/AR, droits RGPD, suppression de compte), arabe/RTL.
4. **Les suites de tests du dépôt (API et base) ne sont pas exécutables de façon isolée** : elles sont liées au conteneur historique et au port 5432. Les chiffres annoncés (358, 363, 18/18) restent **non vérifiés**. L'E2E 4/4 est **confirmé**.
5. **Rien n'est sécurisé côté Git :** 11 branches locales, aucune fusionnée, aucune poussée, et un correctif de sécurité non commité. Les images Docker testées ne correspondent à aucun commit.
6. **Défauts concrets constatés :**
   - aucune carte « À faire » n'est créée à la clôture de l'appel ;
   - des canaux SMS et WhatsApp sont présents dans le code ;
   - `passwordHash` est lisible par le rôle applicatif sur la table `User`, qui n'a pas de RLS ;
   - la limite de débit s'applique aussi au health check ;
   - les images de production embarquent le seed et le SQL de démo ;
   - le code legacy à la racine ne compile pas.
7. **Décision : DÉVELOPPEMENT EN COURS.** Une démonstration limitée du cœur web est possible ; un pilote ne l'est pas tant que les P0 et P1 ne sont pas traités.

## 2. État général du produit
- **Niveau de développement :** console web Next.js et API NestJS avec PostgreSQL et RLS, couvrant les lots internes 1 à 10. Ces lots correspondent à une partie seulement des lots 1 à 4 du CDC, plus un durcissement technique partiel.
- **Fonctionnalités opérationnelles,** testées sur l'arbre de travail avec données fictives :
  - authentification (mot de passe Argon2id, MFA TOTP, refresh, logout, appareils) et sessions web par cookies + CSRF ;
  - isolation multi-école ;
  - import CSV des élèves ;
  - appel matin et après-midi, avec clôture et réouverture ;
  - justificatifs avec pièce jointe ;
  - annonces et accusés de lecture ;
  - devoirs ;
  - notifications in-app d'absence ;
  - contrôle et export Massar ;
  - tableau de bord direction ;
  - super-admin (validation et suspension d'une école) ;
  - images Docker et persistance des données.
- **Fonctionnalités incomplètes :**
  - ciblage des messages (pas de niveau ni de sélection) ;
  - statut de justificatif « à compléter » absent ;
  - carte « À faire » non générée à la clôture ;
  - MFA par e-mail absent ;
  - stockage local seulement (S3 non implémenté, pas d'antivirus) ;
  - pas de paramètres école ;
  - modèle de données de facturation école présent (Plan, Invoice), mais encaissement et tarif par enfant non construits ;
  - consentements : modèle seul, sans écran.
- **Fonctionnalités absentes :**
  - application mobile Flutter ;
  - espace élève ;
  - transport (§5) ;
  - notifications push FCM/APNs ;
  - mode hors-ligne ;
  - lien magique ;
  - rappel à l'enseignant ;
  - rendu de devoir et emploi du temps ;
  - résumé hebdomadaire ;
  - suppression de compte ;
  - CGU FR/AR et droits RGPD intégrés ;
  - purge de rétention ;
  - arabe et RTL ;
  - observabilité ;
  - pentest et test de charge.
- **Limites actuelles :** tout a été testé en local sur des données fictives. Il n'y a pas de HTTPS, pas de sauvegarde testée en isolation, pas de CI prouvée sur le code des lots.

## 3. Matrice de traçabilité du CDC (§3 à §17, Avenant n°1 intégré)
**Abréviations :**
- « Test » renvoie à l'identifiant de la vérification du temps B (fichier `temps_B.md`).
- « VA » = vérification de l'audit ; « E2E » = specs Playwright du dépôt.
- « — » = aucun test exécuté.

| § | Exigence du CDC | Statut | Preuve / fichier ou module | Test exécuté | Écart |
|---|---|---|---|---|---|
| 3.1 | Choix de la langue FR/AR + choix parmi 5 profils à la première ouverture | ABSENT | Aucune page (`apps/web/app/page.tsx`, `login/page.tsx`) | — | Écran inexistant |
| 3.1 | Profil mémorisé sur le compte | PARTIEL | `User.activeProfileId` (`schema.prisma:129`) | — | Pas d'écran |
| 3.2 | Aucun droit avant activation ; école en attente bloquée | TERMINÉ ET TESTÉ | `activation/*`, page `/pending` | VA T35 (403 pour une école en attente) | — |
| 3.2 | École créée et validée par le super-admin | TERMINÉ ET TESTÉ | `admin.controller.ts` | VA B30-B31 | Pièces justificatives (ICE) non gérées |
| 3.2 | Parent : code établissement + code élève, maximum 2 responsables | DÉVELOPPÉ NON TESTÉ | `POST activation/parent` | — (suite du dépôt non exécutée) | Limite de 2 responsables non vérifiée |
| 3.2 | Enseignant : invitation nominative + affectation | PARTIEL | Invitation `activation.dto.ts:53` ; affectation via fixture | B01-B02 (affectation et refus pour une classe non affectée) | Invitation non testée |
| 3.2 | Accompagnateur unique incluant le chauffeur (Avenant n°1) : invitation, circuits, vérification | PARTIEL | Rôle `bus_attendant` (`schema.prisma:43`) | — | Ni circuit ni interface |
| 3.2 | Élève : code établissement + identifiant ; même politique à tous les niveaux, consentement parental (Avenant n°1) | ABSENT | `students/:id/activation-code` seulement | — | Aucune connexion ni interface élève |
| 3.2 | Correction du profil avant activation | ABSENT | NON TROUVÉ | — | — |
| 3.3 | Profils multiples + sélecteur | DÉVELOPPÉ NON TESTÉ | `POST me/profiles/select` | — | — |
| 3.4 | Connexion par e-mail + mot de passe (Argon2) | TERMINÉ ET TESTÉ | `auth.service.ts:138` | VA T02-T05 | — |
| 3.4 | Lien magique | ABSENT | NON TROUVÉ | — | — |
| 3.4 | MFA obligatoire pour École et Super-admin | PARTIEL | TOTP (`mfa.service.ts`) | VA T08-T12, B30 | TOTP testé (anti-rejeu OK) ; pas d'OTP par e-mail |
| 3.4 | Verrouillage progressif | PARTIEL | `lockedUntil` ; throttler | VA rate limit : 401×5 puis 429 | Verrouillage par compte non testé |
| 3.4 | Déconnexion des sessions inactives | ABSENT | NON TROUVÉ | — | — |
| 3.4 | Appareils connectés + révocation | TERMINÉ ET TESTÉ | `me.controller.ts`, `token.service.ts:222` (**non commité**) | VA T17-T20 | Valable seulement pour l'arbre de travail |
| 3.4 | Suppression de compte dans l'application + anonymisation | ABSENT | Seulement `UserStatus.deleted` | — | Exigence des stores |
| 3.5 | Matrice des droits | PARTIEL | Gardes de rôle | VA T28-T29, B02, B09, B16, B26 (enseignant → export 403) | Lignes transport, élève et facturation sans code |
| M1 | Isolation RLS par école | TERMINÉ ET TESTÉ | `010_rls.sql` (37 policies, 30 FORCE) | VA D5, R1-R5, T30-T33, T36, B15-B16 | Table `User` sans RLS (R9) |
| M1 | Exception super-admin journalisée ; journal d'audit consultable | TERMINÉ ET TESTÉ | `audit.controller.ts` | VA B28 | Accès support « sur demande » sans workflow |
| M1 | Journal inaltérable | TERMINÉ ET TESTÉ | trigger `010_rls.sql:281` | VA R6-R7, B29 | — |
| M2 | Import CSV + aperçu + rapport d'erreurs | TERMINÉ ET TESTÉ | `imports/*` | VA B24 | XLSX, zip bomb et formules non testés par l'audit |
| M2 | Idempotence des codes Massar | TERMINÉ ET TESTÉ | `imports.service.ts` | VA B25 | Testé sur 2 lignes, pas sur 400 |
| M2 | Calendrier configurable (Africa/Casablanca) | PARTIEL | `core/school-year.ts` | — | Jours ouvrés et vacances absents |
| M2 | Fiche PDF A4 des codes | ABSENT | NON TROUVÉ | — | — |
| M2 | Révocation d'accès par l'école | PARTIEL | Révocation d'appareil par l'utilisateur | — | — |
| M3 | Session date + classe + demi-journée | TERMINÉ ET TESTÉ | `attendance.controller.ts` | VA B03-B05 ; E2E 01-teacher | — |
| M3 | Saisie, compteur, clôture, verrouillage, réouverture auditée | TERMINÉ ET TESTÉ | idem | VA B06-B11 ; E2E | Ergonomie (64 px, 40 s) non mesurée |
| M3 | 30 élèves en 40 s ou moins | À VÉRIFIER MANUELLEMENT | — | API seule : saisie groupée de 30 élèves en 132 ms | Aucune mesure humaine |
| M3 | Appel hors-ligne | ABSENT | Champs « réservés » (`schema.prisma:528,552`) | — | — |
| M3 | À la clôture : notification au parent + carte « À faire » + information élève | PARTIEL | `NotificationsService` | VA B12 : notification in-app OK ; **0 ParentAction** | Pas de push, pas de carte, pas d'élève |
| M3 | Rappel à l'enseignant (7h45) | ABSENT | NON TROUVÉ | — | — |
| M4 | Justificatif avec motif, texte et pièce jointe (contrôle du type) | TERMINÉ ET TESTÉ | `parent-space/*`, `file-signature.ts` | VA B13-B15 ; E2E 02-parent | Antivirus absent |
| M4 | Workflow en attente / accepté / refusé / à compléter | PARTIEL | enum `JustificationStatus` | VA B17-B18 | « à compléter » absent |
| M4 | Cartes « À faire » (maximum 5) | DÉVELOPPÉ NON TESTÉ | `ParentAction`, `parent-actions` | — | Création manuelle par l'école seulement |
| M5 | Messages ciblés (école, niveau, classe, sélection, élève) | PARTIEL | `MessageAudience` | VA B19-B21, T36 | Pas de niveau ni de sélection |
| M5 | Pas de groupe ni de chat libre | DÉVELOPPÉ NON TESTÉ | Aucune route de groupe | — | — |
| M6 | Devoirs et événements | TERMINÉ ET TESTÉ | `agenda/*` | VA B23 | Typologie différente du CDC |
| M6 | Emploi du temps | ABSENT | NON TROUVÉ | — | — |
| M6 | Rendu de devoir + suivi | ABSENT | Aucun `HomeworkSubmission` | — | — |
| M7 | Résultats saisis par l'enseignant ; résumé hebdomadaire | ABSENT | NON TROUVÉ | — | — |
| M8 | Espace élève | ABSENT | Aucune route ni page | — | Avenant : même politique à tous les niveaux, consentement parental (à construire) |
| M9 | Tableau du jour | TERMINÉ ET TESTÉ | `dashboard/*` | VA B27 ; E2E 03 | Pas de retards de bus (transport absent) |
| M9 | Paramètres de l'école | ABSENT | NON TROUVÉ | — | — |
| M9 | Export Excel Massar + contrôles | TERMINÉ ET TESTÉ | `massar/*` | VA B26 | Écran « Comment ça marche » non trouvé ; non validé face à Massar réel |
| M10 | Création, validation et suspension d'école | TERMINÉ ET TESTÉ | `admin.controller.ts`, `saas.controller.ts` | VA B30-B32 | — |
| M10 | Tableau de bord global | DÉVELOPPÉ NON TESTÉ | `admin/overview` | — | — |
| §5 | Transport (5.2 à 5.6) | ABSENT | Aucun modèle, route ni page | — | Profil Accompagnateur unique (Avenant), à construire |
| §6 | Push FCM/APNs avec file d'attente, délai inférieur à 2 min | ABSENT | NON TROUVÉ | — | — |
| §6 | Centre de notifications in-app | TERMINÉ ET TESTÉ | `notifications` | VA B12 (`GET /notifications` 200) | — |
| §6 | Aucun SMS ni WhatsApp | ABSENT (non conforme) | `channels.ts:39-47` | VA B34 : `sms` et `whatsapp` exposés | À retirer (P0) |
| §7 | Tarif 100 DH HT / 120 TTC par enfant (Avenant) | PARTIEL | `Plan.priceMinor`, `Invoice` (niveau école) | B33 (constat) | Calcul par enfant non trouvé |
| §7 | Paiement en ligne parent / opérateur | Hors périmètre (Avenant n°1) | `NotConfiguredBillingProvider` | — | À retirer ou neutraliser |
| §7 | **Facturation école à construire** : collecte par l'école, virement unique vers ORYA, statuts, reçus | PARTIEL | `admin/schools/:id/invoices`, `invoices/:id/collect`, `subscription.interceptor.ts` | VA B32 (suspension) | Facture, virement et rapprochement non testés ; reçus absents |
| §8 | Argon2, MFA, jetons courts + rotation, révocation | TERMINÉ ET TESTÉ | auth/* | VA T02-T20 | Révocation non commitée |
| §8 | Limitation de débit, validation stricte, API versionnée | TERMINÉ ET TESTÉ | `main.ts`, throttler | VA T03, test de rate limit | S'applique au health check ; `trust proxy` absent |
| §8 | Cookies httpOnly + CSRF, CORS | TERMINÉ ET TESTÉ | `cookie-session*.ts` | VA T21-T26, D04-D06, D09 | Secure/HTTPS non testé |
| §8 | Stockage privé, contrôle de type, antivirus, URL signées | PARTIEL | stockage local, magic bytes | VA B14, D11 | S3 non implémenté, pas d'antivirus |
| §8 | Journal sans données d'élève dans les logs | TERMINÉ ET TESTÉ | — | VA L1, L2 (aucun mot de passe, JWT ni e-mail) | — |
| §8 | Chiffrement au repos, TLS 1.2 | ABSENT | NON TROUVÉ | — | — |
| §8 | Sécurité mobile | ABSENT | pas d'application | — | — |
| §8 | Hébergement Maroc / UE | ABSENT | NON TROUVÉ | — | — |
| §8 | Sauvegarde quotidienne chiffrée, PRA | PARTIEL | `scripts/backup-db.ps1` (manuel) | NON TESTÉ (lié au conteneur historique) | — |
| §8 | Pentest, charge, revue de dépendances | PARTIEL | npm audit : API 14 (3 hautes), web 16 modérées | npm audit (temps A) | Pas de pentest ni de test de charge |
| §9 | CNDP | À VÉRIFIER MANUELLEMENT | aucune preuve | — | Formalité externe |
| §9 | Consentements tracés, consentement parental (Avenant : tous les élèves) | PARTIEL | modèle `Consent` | — | Aucun écran ni endpoint |
| §9 | Droits d'accès, de rectification, d'opposition et d'effacement ; CGU FR/AR ; purge de rétention | ABSENT | NON TROUVÉ | — | — |
| §9 | Contrat de sous-traitance / transfert | À VÉRIFIER MANUELLEMENT | — | — | Juridique |
| §10 | Performance, disponibilité, charge | À VÉRIFIER MANUELLEMENT | — | — | Aucune mesure |
| §10 | FR + AR (RTL) | ABSENT | textes FR codés en dur | — | — |
| §10 | Accessibilité | À VÉRIFIER MANUELLEMENT | `globals.css` | — | — |
| §10 | Hors-ligne | ABSENT | — | — | — |
| §11 | Mobile Flutter | ABSENT | — | — | — |
| §11 | Next.js + NestJS + PostgreSQL RLS | TERMINÉ ET TESTÉ | `apps/web`, `apps/api` | S1-S7, D1-D5, K1-K9 | — |
| §11 | WebSocket/Redis, géolocalisation, FCM | ABSENT | — | — | — |
| §11 | Observabilité | ABSENT | — | — | — |
| §12 | Modèle de données minimal | PARTIEL | 32 tables ; manquent les tables de transport, HomeworkSubmission, Payment et Receipt | D2, D5 | Payment et Receipt sont à redéfinir selon l'Avenant (facturation école) |
| §13 | Interfaces : Commun / École / Parent / Enseignant / Super-admin / Accompagnateur / Élève | PARTIEL / PARTIEL / PARTIEL / PARTIEL / TERMINÉ ET TESTÉ (validation, suspension) / ABSENT / ABSENT | 29 pages web | E2E 4/4, VA | Pas de mobile |
| §14 | Couleurs de la charte | DÉVELOPPÉ NON TESTÉ | `globals.css:8-16` | — | Pas de vérification visuelle |
| §14 | Typographie, logo, voix | À VÉRIFIER MANUELLEMENT | — | — | — |
| §15 | Parcours de recette (10) | PARTIEL | Parcours 3, 4 (sans push), 5, 8 et 10 couverts partiellement | E2E + VA | Parcours 1, 2 (400 lignes), 6, 7 et 9 absents ou non testés |
| §15 | « Aucun SMS ni WhatsApp dans le code » | ABSENT (non conforme) | `channels.ts` | B34 | — |
| §16 | Lots CDC 1 à 7 | voir §5 | — | — | — |
| §17 | Hors périmètre respecté | DÉVELOPPÉ NON TESTÉ | aucun chat libre ni IA trouvé | — | Le paiement en ligne s'ajoute au hors périmètre (Avenant) |

## 4. Tableau d'avancement par module
| Module | Objectif | État du code | Parcours réellement fonctionnel | Tests | Problèmes | Statut |
|---|---|---|---|---|---|---|
| Auth / sessions | Connexion sûre | Complet (sans lien magique, sans OTP e-mail) | Connexion, MFA, refresh, logout, cookies | VA T01-T26 | Révocation non commitée | TERMINÉ ET TESTÉ |
| Multi-tenant RLS | Isolation | 37 policies | Refus inter-écoles | VA R1-R9, T30-T36 | `User` sans RLS, `passwordHash` lisible | TERMINÉ ET TESTÉ (avec réserve P0) |
| Import | Rentrée | CSV/XLSX | Aperçu, commit, idempotence | VA B24-B25 | Pas de PDF des codes | TERMINÉ ET TESTÉ |
| Présences | Appel | En ligne seulement | Ouverture, saisie, clôture, réouverture | VA B01-B12, E2E | Pas de hors-ligne, pas de carte « À faire » | PARTIEL |
| Justificatifs | Absences | Workflow à 3 états | Dépôt, examen, statut | VA B13-B18, E2E | Pas de « à compléter », pas d'antivirus | PARTIEL |
| Communication | École → familles | Annonces, classe, individuel | Annonce + accusé | VA B19-B22 | Ciblage incomplet ; canaux SMS/WA | PARTIEL |
| Agenda / devoirs | Devoirs | Création et consultation | Devoir créé et vu | VA B23 | Pas de rendu ni d'emploi du temps | PARTIEL |
| Tableau de bord | Pilotage | Résumé + export | Lecture | VA B27, E2E | Pas de paramètres | PARTIEL |
| Massar | Export | Contrôle + 5 rapports | CSV/XLSX | VA B26 | Non validé avec Massar réel | TERMINÉ ET TESTÉ (format interne) |
| Super-admin / SaaS | Écoles, abonnements | Validation, suspension, plans, factures | Validation, suspension | VA B30-B33 | Facturation école incomplète | PARTIEL |
| Notifications | Alertes | In-app seulement | Absence → notification | VA B12 | Pas de push | PARTIEL |
| Stockage | Fichiers privés | Local | Écriture et relecture | VA B13, D11 | S3 absent | PARTIEL |
| Transport | Bus | — | — | — | — | ABSENT |
| Espace élève | Élève | — | — | — | — | ABSENT |
| Mobile | Terrain | — | — | — | — | ABSENT |
| Conformité | 09-08 | Modèle `Consent` | — | — | — | PARTIEL |
| Déploiement | Images | Dockerfiles API, migrate et web | Build, migrate, health, persistance | K1-K9, D01-D11 | Images liées à aucun commit ; seed dans l'image | PARTIEL |
| Legacy racine | — | Ancienne maquette | — | S8 : 15 erreurs TS | À supprimer | ABSENT (inexploitable) |

## 5. État des lots de la roadmap
Les lots internes (1 à 10) **ne sont pas** les lots du CDC (1 à 7). L'avancement ci-dessous est calculé à partir des fonctionnalités prouvées, pas des pourcentages annoncés auparavant.

| Lot interne | Objectif initial | Livré (preuve) | Incomplet / bugs / risques | Statut réel |
|---|---|---|---|---|
| 1 Fondations | Comptes, RLS, audit | Auth, MFA, RLS, audit (VA) | Choix de profil et de langue absent | PARTIEL |
| 2.1 Import | Import des élèves | B24-B25 | PDF des codes absent | TERMINÉ ET TESTÉ |
| 2.2 / 2.3 Présences (API + UI) | Appel | B01-B11, E2E 01 | Hors-ligne, carte « À faire » | PARTIEL |
| 3 Élèves et familles | Fiche, responsables | T32-T34 (lecture) ; liens non testés par l'audit | — | DÉVELOPPÉ NON TESTÉ (sauf lecture) |
| 4 Espace parent | Justificatifs, notifications | B12-B18, E2E 02 | Antivirus, « à compléter » | PARTIEL |
| 5 Communication | Messages | B19-B21 | SMS/WA présents | PARTIEL |
| 6 Agenda / devoirs | Devoirs | B23 | Rendu, emploi du temps | PARTIEL |
| 7 Tableau de bord | Pilotage | B27 | — | TERMINÉ ET TESTÉ |
| 8 Massar | Exports | B26 | Validation réelle | TERMINÉ ET TESTÉ (interne) |
| 9 SaaS admin | Écoles, abonnements | B30-B33 | Facturation école | PARTIEL |
| 10 Finalisation / lancement | Playwright, cookies, Docker, sauvegardes | E2E 4/4, D01-D11, T21-T25 | Sauvegarde NON TESTÉE ; rien n'est commité | PARTIEL |

**Ce que recouvre le « lot 10 » :** c'est un lot de **finalisation technique** de la console web : tests E2E, cookies httpOnly et CSRF, préparation Docker, scripts de sauvegarde, états d'erreur, démo [DEMO].
- Il **ne correspond pas** au lot CDC 7 « Durcissement » (pentest, charge, PRA, stores).
- Il ne couvre pas non plus les lots CDC 5 (Transport) et 6 (Paiement et conformité, à redéfinir selon l'Avenant).

**Correspondance avec les lots du CDC :**

| Lot CDC | Couverture |
|---|---|
| 1 Fondations | PARTIEL (choix du profil absent) |
| 2 Cœur scolaire | PARTIEL (hors-ligne et push absents) |
| 3 Communication | PARTIEL (rendu de devoir et emploi du temps absents) |
| 4 Élève et pilotage | PARTIEL (élève absent) |
| 5 Transport | ABSENT |
| 6 Facturation école et conformité (Avenant) | PARTIEL (modèle Plan et Invoice) / ABSENT pour CGU, consentements et droits |
| 7 Durcissement | ABSENT |

## 6. Registre des contradictions
| Affirmation / source | Constat de l'audit | Verdict |
|---|---|---|
| « 358/358 tests API » (roadmap l. 177, sur `e018619`) | Suite non exécutable sans `orya-postgres` et `:5432` codés en dur ; environ 355 `Assert-True` statiques dans le fichier, lui-même **modifié non commité** | Impossible à vérifier |
| « 363/363 tests API » (rapports récents) | Idem ; ce chiffre porterait sur du code non commité | Impossible à vérifier |
| « 109/109 » (`PROJECT_STATUS.md`) et « 63/63 » (`etat-2026-10-30.md`) | Documents obsolètes qui contredisent la roadmap | Contredite (périmée) |
| « 18/18 tests DB » | Suite non exécutable de façon isolée. Les VA confirment les migrations, le RLS et le trigger | Partiellement confirmée (par VA, pas par la suite) |
| « 4/4 E2E » | 4 passed : 3 specs, dont une sur 2 projets, contre la pile Docker de l'audit | Confirmée par cet audit (sur l'arbre de travail) |
| « Lots 2.3 à 10 terminés » | Lots internes ≠ lots CDC 1 à 7 ; plusieurs sont PARTIELS ; aucun n'est fusionné dans `main` | Contredite |
| « Images Docker construites, smoke tests OK » | Rebuild et smoke 11/11 OK, mais **les images proviennent d'un arbre non commité et ne correspondent à aucun commit**. Les logs de smoke historiques n'ont pas été lus | Partiellement confirmée |
| « Bases orya et orya_v2 intactes » | Non inspectées, conformément à la mission | Impossible à vérifier |
| « Cookies httpOnly + CSRF opérationnels » | VA T21-T25, D04-D06 ; Secure non testé | Confirmée (HTTP local) |
| « Absence de vulnérabilités critiques » | 0 critique, mais 3 hautes côté API | Partiellement confirmée |
| « Sauvegarde / restauration testées » | Scripts liés au conteneur historique, non exécutés | Impossible à vérifier |
| « 37 policies / 30 FORCE / 12 migrations » | Recomptées en exécution | Confirmée |
| Commentaire `010_rls.sql` : « FORCE empêche le propriétaire de contourner le RLS » | `orya_owner` (BYPASSRLS) voit tout (R8) | Contredite |
| Commentaire de `Dockerfile.api` : « runtime sans SQL de rôles » | L'image contient `prisma/sql/000_roles.sql`, `seed.ts` et le SQL de démo (K4) | Contredite |
| Lint web « 26 avertissements » | 22 avertissements | Contredite (valeur différente) |
| CDC : « aucun canal SMS ni WhatsApp dans le code » | `SmsChannel` et `WhatsAppChannel` présents (B34) | Contredite |
| `docs/avenant-cdc-v1.md` contre l'Avenant n°1 donné en conversation | Le fichier présente le paiement comme reporté et l'accompagnateur Flutter comme « à confirmer », alors qu'en conversation l'école paie par virement et l'accompagnateur inclut le chauffeur | Contradiction documentaire à corriger |
| README : « Flutter Lot 5 » contre roadmap : « Lot 5 = Communication » | Numérotations incompatibles | Contredite |

## 7. Architecture et qualité technique
- **Architecture :**
  - monorepo sans workspaces : `apps/api` (NestJS 11, Prisma 6.19, 99 endpoints dans 19 contrôleurs) et `apps/web` (Next 16.4.2, React 19.3, 29 pages) ;
  - PostgreSQL 16 avec RLS piloté par `set_config` dans `TenancyService`, et contrôle statique T13 qui le vérifie ;
  - l'architecture est saine pour la console.
- **Qualité :**
  - typecheck et builds API et web à 0 erreur ; lint à 0 erreur et 22 avertissements ;
  - encodage contrôlé ;
  - validation stricte des entrées.
- **Dette technique :**
  - legacy à la racine (`src/`, `prisma/`, Next racine), cassé avec 15 erreurs TS ;
  - Prisma 7 non migré (avertissement de dépréciation et vulnérabilités hautes) ;
  - pilotes factices (S3, paiement, canaux) ;
  - textes codés en dur (pas d'i18n) ;
  - `package.json#prisma` déprécié.
- **Risques principaux :**
  - historique Git non sauvegardé et non fusionné ;
  - scripts de test dangereux pour le cluster historique ;
  - table `User` sans RLS ;
  - port par défaut 3001 (celui du prototype) ;
  - CI déclenchée seulement sur `main` et les PR.

## 8. Résultats détaillés des tests
Le détail complet est dans `/workspace/audit/temps_B.md` (sur le box de l'auditeur) ; en voici la synthèse. **Ces résultats ne s'additionnent pas : ce sont des familles distinctes.**
- **Statique (S1 à S8) :**
  - 7 commandes réussies (code de sortie 0) ;
  - la compilation TypeScript du legacy à la racine échoue (code 2, 15 erreurs).
- **Base de données, VA :**
  - D1 à D5 réussies. Le premier `migrate deploy` a échoué (P3018) à cause de la façon dont j'avais créé la base d'audit (problème d'environnement) ;
  - R1 à R9 réalisées. Les points R8 et R9 sont des constats de risque, pas des échecs de test ;
  - P1 (persistance) réussie.
- **API, VA (`audit-api.ps1`) :**
  - premier passage : 64 PASS et 5 FAIL. Les 5 échecs étaient des erreurs de l'audit (corps de requête erronés, fixture inadaptée) ;
  - une fois rejoués correctement, ils passent, avec une anomalie réelle : **aucune carte « À faire »** n'est créée à la clôture (B12) ;
  - B22 est non concluant (compte parent de l'école B inexistant).
- **Limitation de débit (valeurs par défaut) :**
  - connexion : 5 réponses 401 puis des 429, comme attendu ;
  - **le health check est limité à 120 requêtes par minute** (10 réponses 429 sur 130 appels).
- **E2E Playwright (specs du dépôt) :** 4 passed en 18,9 s.
- **Docker :**
  - K1 à K9 réussies ;
  - D01 à D11 : 11 sur 11 ;
  - journaux sans secrets.
- **Non exécuté :**
  - suites API, DB et E2E-wrapper du dépôt ;
  - `demo-env.ps1` et les scripts de sauvegarde et restauration ;
  - suite preprod ;
  - tests unitaires (le dépôt n'en contient aucun) ;
  - charge, pentest, mobile, HTTPS.

## 9. Sécurité et conformité
- **Mécanismes développés et testés (VA) :**
  - Argon2id, MFA TOTP avec anti-rejeu ;
  - rotation et détection de rejeu des refresh tokens, révocation immédiate au logout (non commitée) ;
  - cookies httpOnly SameSite=Strict, CSRF par double soumission, CORS sur liste d'origines ;
  - helmet, validation par whitelist, limitation de débit ;
  - RLS, journal d'audit inaltérable ;
  - contrôle du type de fichier par magic bytes ;
  - absence de secrets et de PII dans les journaux.
- **Développés mais non testés :** verrouillage par compte, profils multiples, invitations, garde XLSX contre les zip bombs.
- **Préparés seulement :** S3, fournisseur de paiement (hors périmètre selon l'Avenant), canaux e-mail, SMS et WhatsApp.
- **Constats défavorables :**
  - `User.passwordHash` est lisible par `orya_app` sur une table sans RLS ;
  - le health check est soumis à la limite de débit ;
  - pas de `trust proxy` ;
  - le cookie `Secure` n'a pas été testé ;
  - 3 vulnérabilités npm hautes.
- **Formalités non réalisées (aucune preuve dans le dépôt) :** déclaration ou autorisation CNDP (loi 09-08), notamment pour les données de mineurs et la géolocalisation ; contrat de sous-traitance école-ORYA ; clauses de transfert si l'hébergement est hors Maroc ; CGU et politique de confidentialité FR/AR ; durées de conservation.
- **Mineurs :** selon l'Avenant n°1, tous les élèves sont mineurs et le consentement parental est requis. Le modèle `Consent` existe, mais **aucun parcours de consentement n'est implémenté**.
- **Transferts internationaux :** aucune décision d'hébergement n'est trouvée.
- **Expertise externe nécessaire :** pentest indépendant, avis juridique 09-08/CNDP. **Cette section est une analyse technique et ne constitue pas un avis juridique.**

## 10. État Git et livrables locaux
- **Branche :** `feature/lot-10-launch`, HEAD `e018619`. `main` = `develop` = `origin/main` = `4f33117`.
- **11 branches de lots locales**, ni poussées ni fusionnées.
- **17 fichiers modifiés non commités**, dont le correctif de révocation (`guards.ts`, `token.service.ts`), les Dockerfiles et la compose d'exemple.
- **Non suivis :** `.dockerignore`, `eslint.config.mjs`, `RELEASE_MANIFEST`, `CHECKLIST_MISE_EN_PRODUCTION`, `e2e/preprod*`, un PDF de guide de 3 Mo.
- **Risque de release :** un clone propre ne reproduirait ni les images testées, ni le lint, ni le correctif de sécurité. Une panne du disque ferait perdre les lots 2.2 à 10.
- **Pendant l'audit :** aucune modification du dépôt, en dehors de ce rapport et des sorties de build et de test dans des dossiers ignorés par Git.

## 11. Script de démonstration à une école partenaire
Réalisable sur un environnement isolé avec des données [DEMO]. Le résultat constaté est celui du temps B.

| Profil | Étape | Action | Résultat attendu | Résultat constaté | Statut |
|---|---|---|---|---|---|
| Direction | 1 | Connexion + MFA TOTP | Tableau de bord | T08-T11, E2E 03 | réussi |
| Direction | 2 | Import CSV des élèves (aperçu, validation) | Élèves créés sans doublon | B24-B25 | réussi |
| Direction | 3 | Tableau du jour | Indicateurs | B27 | réussi |
| Direction | 4 | Examiner un justificatif | Statut accepté | B17, E2E 03 | réussi |
| Direction | 5 | Envoyer une annonce, suivre les accusés | Le parent la reçoit et en accuse réception | B19-B21 | réussi |
| Direction | 6 | Contrôle + export Massar du mois | Fichier CSV/XLSX | B26 | réussi (format interne ; non validé face à Massar) |
| Direction | 7 | Réouvrir un appel clôturé avec motif | Réouverture tracée | B10-B11 | réussi |
| Direction | 8 | Paramètres de l'école, circuits | — | NON TROUVÉ | absent |
| Enseignant | 1 | Connexion, appel du jour (roster de 30 élèves) | Liste | B01, E2E 01 | réussi |
| Enseignant | 2 | Saisie présent / absent / retard, clôture | Appel clôturé, verrouillé | B06-B08 | réussi |
| Enseignant | 3 | Créer un devoir | Visible par le parent | B23 | réussi |
| Enseignant | 4 | Appel hors-ligne | — | — | absent |
| Parent | 1 | Connexion, fiche de son enfant | Son enfant uniquement | T34, T33 | réussi |
| Parent | 2 | Notification d'absence | Notification in-app | B12 | réussi (in-app ; pas de push) |
| Parent | 3 | Carte « À faire » après l'absence | Carte créée | 0 ParentAction | échoué |
| Parent | 4 | Déposer un justificatif + PDF (mobile et bureau) | Statut visible | B13, B18, E2E 02 | réussi |
| Parent | 5 | Lire une annonce et en accuser réception | Accusé enregistré | B20-B21 | réussi |
| Parent | 6 | Suivi du bus, facture et reçu | — | — | absent |
| Élève | 1 | Connexion et consultation | — | — | absent |
| Accompagnateur (chauffeur inclus) | 1 | Feuille de route, montée et descente | — | — | absent |
| Super-admin | 1 | Connexion + MFA, liste des écoles | Liste | B30 | réussi |
| Super-admin | 2 | Valider une école en attente | École active | B31 | réussi |
| Super-admin | 3 | Suspendre une école (avec motif) → lecture seule | Écriture 403 | B32 | réussi |
| Super-admin | 4 | Facturation école (virement unique) | — | — | non testé (à construire) |

**Fonctionnalités que l'on peut montrer sans risque** (vérifiées, sur la console web, avec données [DEMO]) :
- connexion avec MFA ;
- import CSV ;
- appel du jour avec clôture et réouverture ;
- justificatif d'absence et son examen ;
- annonce avec accusé de lecture ;
- devoir ;
- notification in-app d'absence ;
- tableau de bord ;
- export Massar (présenté comme « fichier compatible », jamais « synchronisé ») ;
- validation et suspension d'école par le super-admin ;
- vue parent sur mobile web (justificatif).

**À ne pas montrer :** l'espace élève, le transport, l'application mobile, les notifications push, le mode hors-ligne, la facturation et la carte « À faire » automatique.

## 12. Scores de maturité
**Méthode :** points de contrôle vérifiés par une preuve, divisés par les points de contrôle totaux, × 100. Seul le statut « vérifié au temps B » compte. **Je ne calcule pas de moyenne globale.**

| Dimension | Points de contrôle (✔ = vérifié) | Score |
|---|---|---|
| Fonctionnalités métier | ✔ isolation ; ✔ import + idempotence ; ✔ appel + clôture/réouverture ; ✘ appel hors-ligne ; ✔ justificatifs ; ✘ carte « À faire » ; ✔ annonces + accusés ; ✔ devoirs ; ✘ rendu de devoir / emploi du temps ; ✘ espace élève ; ✔ tableau de bord ; ✔ export Massar ; ✔ super-admin ; ✘ transport ; ✘ push ; ✘ facturation école | 9/16 = **56 %** |
| Frontend et UX | ✔ build web ; ✔ parcours E2E (3) ; ✔ parcours mobile web parent ; ✘ FR/AR et RTL ; ✘ choix de langue et de profil ; ✘ application mobile ; ✘ accessibilité vérifiée ; ✘ charte vérifiée visuellement | 3/8 = **38 %** |
| API et architecture | ✔ API versionnée ; ✔ validation stricte ; ✔ RLS / tenancy ; ✔ contrôle T13 ; ✔ typecheck et build ; ✘ legacy sain ; ✘ temps réel (WebSocket/Redis) ; ✘ stockage objet ; ✘ observabilité | 5/9 = **56 %** |
| Sécurité | ✔ Argon2 ; ✔ MFA anti-rejeu ; ✔ rotation et rejeu des refresh ; ✔ révocation au logout ; ✔ cookies + CSRF ; ✔ CORS ; ✔ limitation de débit ; ✔ RLS ; ✔ audit inaltérable ; ✔ contrôle des uploads ; ✘ `User.passwordHash` protégé ; ✘ aucun SMS/WA ; ✘ HTTPS/Secure ; ✘ antivirus ; ✘ pentest ; ✘ 0 vulnérabilité haute | 10/16 = **62 %**, avec un blocage P0 sur la table `User` |
| Qualité et couverture des tests | ✘ suite API du dépôt exécutée ; ✘ suite DB du dépôt exécutée ; ✔ E2E ; ✘ tests unitaires ; ✘ CI sur les branches ; ✔ contrôles statiques ; ✘ scripts de test isolables ; ✘ test de charge | 2/8 = **25 %** |
| Fiabilité des données | ✔ migrations sur base neuve ; ✔ RLS et seed idempotents ; ✔ persistance après redémarrage ; ✔ pas de doublon Massar ; ✔ audit inaltérable ; ✘ sauvegarde/restauration testée ; ✘ purge de rétention ; ✘ premier déploiement robuste | 5/8 = **62 %** |
| Infrastructure et déploiement | ✔ build des images ; ✔ health checks ; ✔ job de migration idempotent ; ✘ images liées à un commit ; ✘ HTTPS et domaine ; ✘ hébergement choisi ; ✘ supervision ; ✘ sauvegardes planifiées ; ✘ CI de déploiement | 3/9 = **33 %** |
| Documentation et exploitation | Aucune procédure documentée n'a été rejouée telle quelle ; les documents se contredisent | **NON ÉVALUABLE** |
| Préparation au pilote | CNDP, données réelles, validation Massar et formation non vérifiables | **NON ÉVALUABLE** |
| Préparation à la production | ✘ pentest ; ✘ charge ; ✘ PRA ; ✘ HTTPS ; ✘ mobile et stores ; ✘ CNDP ; ✘ observabilité ; ✘ code fusionné et commité | 0/8 = **0 %** |

Une note élevée ne masque pas les blocages : en sécurité, le point `passwordHash` suffit à bloquer.

## 13. Blocages critiques
1. **Code non commité et non sauvegardé ; branches non fusionnées.** Aucune version reproductible n'existe.
2. **Suites de test du dépôt dangereuses ou non isolables.** Aucune preuve reproductible des chiffres annoncés.
3. **`passwordHash` lisible par le rôle applicatif sur une table sans RLS.**
4. **Non-conformités au CDC sur des points visibles :** SMS et WhatsApp dans le code ; carte « À faire » absente.
5. **Modules majeurs absents pour un pilote complet :** espace élève, application mobile, transport, push, hors-ligne, consentement parental et CGU, facturation école.

## 14. Risques importants
| Risque | Probabilité | Impact |
|---|---|---|
| Perte du travail (disque local, 11 branches non poussées) | Moyenne | Critique |
| Exécution d'un script de test sur le cluster historique (orya, orya_v2) | Moyenne | Critique |
| Fuite des empreintes de mots de passe via `User` | Faible | Critique |
| 429 généralisés derrière un proxy, health check « down » | Élevée en production | Élevé |
| Collecte de données de mineurs sans CNDP ni consentement | Élevée si pilote | Critique (juridique) |
| Export Massar refusé par une vraie école | Moyenne | Élevé |
| Image de production avec seed et SQL de démo exécutables | Faible | Moyen |
| Vulnérabilités Prisma hautes | Faible | Moyen |
| Échec du premier déploiement (propriétaire de la base) | Élevée | Moyen |

## 15. Améliorations non bloquantes
- Migration vers Prisma 7.
- Réduction des 22 avertissements de lint.
- Allègement des images (≈ 850 Mo).
- Renommage des lots pour les aligner sur le CDC.
- Résumé hebdomadaire parent.
- Statistiques avancées.
- Version anglaise.

## 16. Plan d'action priorisé

### P0 — bloquant avant toute préproduction
| # | Tâche | Raison | Action | Livrable attendu | Test d'acceptation | Dépendances | Priorité |
|---|---|---|---|---|---|---|---|
| P0-1 | Sauvegarde distante et commit | 11 branches locales, correctif de sécurité non commité | Commiter l'arbre de travail par lot, pousser toutes les branches vers un dépôt distant privé | Branches et tags poussés | `git status` propre ; `git branch -vv` montre un suivi distant pour les 11 branches | Aucune | P0 |
| P0-2 | Scripts de test redirigeables | Scripts liés à `orya-postgres` et `localhost:5432` ; `ALTER ROLE orya_test` global | Variables d'environnement `ORYA_TEST_CONTAINER`, `ORYA_TEST_DB`, `ORYA_TEST_PORT` ; refus explicite si la base est `orya` ou `orya_v2` ou si le conteneur est `orya-postgres` ; rôle de test propre à la base ou créé dans un conteneur jetable, sans `ALTER ROLE` global | Scripts modifiés et README | Les suites API, DB et E2E passent sur un conteneur dédié (port ≠ 5432) ; un essai avec `orya_v2` est refusé avec un code ≠ 0 | P0-1 | P0 |
| P0-3 | Table `User` | `passwordHash` lisible par `orya_app` sur une table sans RLS (R9) | `REVOKE SELECT (passwordHash)` pour `orya_app` ; vérification du mot de passe via une fonction `SECURITY DEFINER` dédiée ; politique de lecture minimale | Migration + `010_rls.sql` | `has_column_privilege('orya_app','"User"','passwordHash','SELECT')` = false ; connexion toujours OK ; T02-T05 réussis | P0-2 | P0 |
| P0-4 | Trust proxy + health check hors limite de débit | 10 réponses 429 sur 130 appels `/health` ; IP partagée derrière un proxy | `app.set('trust proxy', …)` configurable ; `@SkipThrottle()` sur health | Code + test | 500 appels `/health` → 0 × 429 ; la limite de connexion s'applique par IP client réelle derrière un proxy de test | P0-1 | P0 |
| P0-5 | Carte « À faire » à la clôture de l'appel | CDC M3, B12 échoué | Créer une `ParentAction` « justifier l'absence » pour chaque absent ou retardataire à la clôture | Code + test API | Après clôture avec 1 absent lié à un parent : 1 ParentAction ouverte, visible dans `/family/actions` | P0-1 | P0 |
| P0-6 | Retrait des canaux SMS et WhatsApp | CDC §2 et §15 (B34) | Supprimer `SmsChannel`, `WhatsAppChannel` et leurs valeurs de types | Code | `git grep -i -E "sms|whatsapp" apps/` ne trouve rien ; `/messages/channels` ne renvoie que `in_app` (et `email` si c'est retenu) | P0-1 | P0 |
| P0-7 | Images de production sans seed ni SQL de démo | K4 | Runtime : copier uniquement `schema.prisma` et `migrations` (ou rien) ; exclure `seed.ts`, `sql/demo` et `000_roles.sql` ; image web en sortie *standalone* | Dockerfiles + `.dockerignore` commités | `docker run … ls /app/prisma` ne montre ni `seed.ts` ni `sql/` ; l'image web ne contient ni `app/*.tsx` ni `.env.example` | P0-1 | P0 |
| P0-8 | Procédure de premier déploiement | P3018 : `orya_owner` doit posséder la base | Script et documentation : `CREATE DATABASE … OWNER orya_owner` (ou `GRANT CREATE`) avant les migrations, puis migrate et roles/RLS | Script + doc d'exploitation | Sur un postgres:16 vierge, la procédure documentée aboutit à 12 migrations et 37 policies sans intervention | P0-2 | P0 |
| P0-9 | Suppression ou exclusion du legacy | `src/`, `prisma/` et Next racine cassés (15 erreurs TS) ; `db:down` dangereux | Supprimer le legacy ou l'archiver hors du dépôt principal ; retirer les scripts racine | Commit | `npx tsc` sans erreur à la racine, ou racine sans projet ; `db:down` absent | P0-1 | P0 |
| P0-10 | Fusion des 11 branches avec CI sur toutes les branches | Rien sur `main` ; CI déclenchée seulement sur `main` et les PR | Fusion ordonnée des lots vers `develop` puis `main` ; CI `on: push` sur toutes les branches, avec suites DB, API et E2E isolées (après P0-2) et lint web | `main` à jour ; workflow CI | CI verte sur `main` après fusion, artefacts conservés ; les images Docker sont taguées avec le SHA du commit | P0-1, P0-2 | P0 |

### P1 — bloquant avant le pilote
| # | Tâche | Raison | Livrable | Test d'acceptation | Dépendances |
|---|---|---|---|---|---|
| P1-1 | Consentement parental + CGU et politique de confidentialité FR/AR avant inscription (Avenant : tous mineurs) | 09-08, CDC §9 | Écrans + API `Consent` versionnée | Inscription impossible sans acceptation ; consentement tracé (version, date) | P0 |
| P1-2 | Déclaration CNDP + contrat de sous-traitance | Collecte réelle de données de mineurs | Récépissé CNDP, contrat signé | Pièces versées au dossier | Juridique |
| P1-3 | Facturation école (Avenant : 100 DH HT / 120 TTC par enfant, virement unique) | Modèle commercial | Calcul par enfant, facture école, rapprochement du virement, statuts, reçu | Facture correcte pour N enfants ; statut « payé » après rapprochement ; test API | P0 |
| P1-4 | Validation Massar avec une école réelle (≈ 400 lignes) | CDC §15 | Rapport de recette signé | Import de 400 lignes sans perte ; export reconnu par l'école | P0 |
| P1-5 | HTTPS, `COOKIE_SECURE`, domaine, hébergement (Maroc ou UE) | §8 | Environnement de préproduction | Cookies `Secure` ; TLS ≥ 1.2 | P0-7, P0-8 |
| P1-6 | Sauvegarde et restauration testées en isolation, chiffrées, planifiées | §8 Résilience | Script + rapport de test | Restauration sur base jetable identique (comptages + policies) | P0-2 |
| P1-7 | Statut de justificatif « à compléter » ; antivirus ; stockage S3 privé | M4, §8 | Code | Tests API | P0 |
| P1-8 | Suppression de compte + anonymisation ; droits d'accès et d'effacement | §3.4, §9 | Endpoint + écran | Compte supprimé, liens anonymisés | P1-1 |
| P1-9 | Arabe et RTL | §10 | i18n | Parcours E2E en arabe | P0 |
| P1-10 | Paramètres école, choix du profil et de la langue | §3.1, M9 | Écrans | E2E | P0 |

### P2 — bloquant avant la production
- Espace élève, avec la même politique à tous les niveaux.
- Application mobile Flutter (enseignant, parent, élève, accompagnateur).
- Notifications push FCM/APNs avec file d'attente, délai inférieur à 2 minutes.
- Mode hors-ligne pour l'appel.
- Transport complet avec un profil Accompagnateur unique incluant le chauffeur (§5).
- Rendu de devoir et emploi du temps.
- Observabilité et supervision.
- Pentest indépendant.
- Test de charge à 5 000 connexions.
- PRA avec RPO et RTO définis.
- Publication sur les stores.
- Migration vers Prisma 7 (vulnérabilités hautes).
- Purge de rétention.

**Format commun aux tâches P2 :**
- *Raison :* exigence du CDC.
- *Livrable :* module et tests.
- *Test d'acceptation :* le parcours de recette §15 correspondant.
- *Dépendances :* P0 et P1.

### P3 — amélioration ultérieure
- Résumé hebdomadaire et résultats enseignant (M7).
- Lien magique et OTP par e-mail.
- Version anglaise.
- Allègement des images.
- Réduction des avertissements de lint.
- Renumérotation des lots.

## 17. Décision finale
**DÉVELOPPEMENT EN COURS.**

**Justification :**
- Le cœur web est fonctionnel et testé sur l'arbre de travail : appel, justificatifs, messages, import, Massar, super-admin, RLS, authentification, Docker.
- Mais :
  - le code n'est ni commité, ni fusionné, ni sauvegardé (P0-1, P0-10) ;
  - les suites de tests du dépôt ne sont pas reproductibles de façon isolée (P0-2) ;
  - il existe un défaut de sécurité sur la table `User` (P0-3) ;
  - plusieurs modules majeurs du CDC sont absents (élève, mobile, transport, push, hors-ligne, conformité, facturation école).
- Le stade « STABILISATION » suppose un périmètre fonctionnel quasi complet, ce qui n'est pas le cas.

## Questions finales
- **ORYA est-il réellement fonctionnel aujourd'hui ?** Oui pour la console web du cœur scolaire, sur l'arbre de travail local et sur données fictives. Non au regard du CDC complet.
- **Quelles fonctionnalités sont réellement utilisables ?**
  - connexion avec MFA ;
  - import CSV ;
  - appel avec clôture et réouverture ;
  - justificatifs ;
  - annonces avec accusé de lecture ;
  - devoirs ;
  - notifications in-app ;
  - tableau de bord ;
  - export Massar ;
  - validation et suspension d'école (super-admin).
- **Que peut-on montrer dès maintenant à une école partenaire ?** La liste « sans risque » du §11, sur un environnement [DEMO] isolé.
- **Quels sont les trois principaux blocages ?**
  1. Code non commité, non fusionné, non sauvegardé.
  2. Suites de tests non isolables, donc aucune preuve reproductible.
  3. Modules majeurs absents (élève, mobile, transport, push, consentement et CGU, facturation école), auxquels s'ajoute le défaut sur `User.passwordHash`.
- **Que faire ensuite, et dans quel ordre ?** P0-1, puis P0-2, puis P0-3 à P0-9, puis P0-10 ; ensuite P1 (conformité et CNDP d'abord, puis facturation école, validation Massar et HTTPS) ; puis P2.
- **Quel est le niveau de confiance de cet audit ?**
  - **Élevé** pour ce qui a été exécuté : statique, base de données, API, E2E, Docker sur l'arbre de travail.
  - **Moyen** pour l'inventaire statique.
  - **Nul** pour ce qui n'a pas été exécuté : suites du dépôt, sauvegardes, production.
- **Quelles parties n'ont pas pu être vérifiées ?**
  - les suites API et DB du dépôt, le wrapper E2E, la suite preprod ;
  - la sauvegarde et la restauration ;
  - les bases `orya` et `orya_v2` ;
  - les journaux de smoke historiques ;
  - HTTPS et Secure ;
  - charge, pentest, mobile ;
  - CNDP et aspects juridiques ;
  - Massar réel ;
  - la CI.
- **Quelles commandes puis-je relancer moi-même ?** Voir l'annexe ci-dessous.

## Annexe — Commandes reproductibles (environnement isolé de l'audit)
Les secrets sont remplacés par `<…>` : générez-les vous-même, par exemple avec `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. N'utilisez **jamais** `orya-postgres`, le port 5432, le port 3001, ni les bases `orya` ou `orya_v2`.

```powershell
# 0. Vérifications préalables (lecture seule)
cd C:\Users\YEP\Projects\orya
git status --porcelain ; git branch -a -vv
docker ps -a ; docker volume ls
Get-NetTCPConnection -LocalPort 55432,13001,13010,13011 -State Listen -ErrorAction SilentlyContinue   # doit être vide

# 1. Vérifications statiques
cd apps\api ; npx prisma validate ; npx tsc --noEmit ; npm test ; npm run build
cd ..\web  ; npm run typecheck ; npm run lint ; npm run build
cd ..\api  ; npm audit --json --package-lock-only     # (idem dans apps\web)

# 2. PostgreSQL d'audit dédié (dossier hors dépôt C:\Users\YEP\orya-audit)
#    compose.audit.yml : service pg, image postgres:16, container_name orya-audit-pg,
#    POSTGRES_USER=audit_admin, POSTGRES_PASSWORD=${PG_ADMIN_PW}, POSTGRES_DB=orya_audit,
#    ports "127.0.0.1:55432:5432", volume nommé pgdata
docker compose -p orya-audit -f C:\Users\YEP\orya-audit\compose.audit.yml --env-file C:\Users\YEP\orya-audit\audit.secrets up -d --wait

# 3. Base jetable (propriétaire orya_owner), rôles, migrations, RLS, seed
"DROP DATABASE IF EXISTS orya_audit WITH (FORCE);" | docker exec -i orya-audit-pg psql -U audit_admin -d postgres
Get-Content apps\api\prisma\sql\000_roles.sql -Raw | docker exec -i orya-audit-pg psql -U audit_admin -d postgres   # crée les rôles
"CREATE DATABASE orya_audit OWNER orya_owner;" | docker exec -i orya-audit-pg psql -U audit_admin -d postgres
"ALTER ROLE orya_owner PASSWORD '<OWNER_PW>'; ALTER ROLE orya_app PASSWORD '<APP_PW>';" | docker exec -i orya-audit-pg psql -U audit_admin -d orya_audit
cd apps\api
$env:DIRECT_DATABASE_URL="postgresql://orya_owner:<OWNER_PW>@127.0.0.1:55432/orya_audit?schema=public"
$env:DATABASE_URL=$env:DIRECT_DATABASE_URL ; npx prisma migrate deploy
$env:DATABASE_URL="postgresql://orya_app:<APP_PW>@127.0.0.1:55432/orya_audit?schema=public" ; npx tsx prisma/apply-sql.ts
$env:SEED_PASSWORD="<SEED_PW>" ; $env:NODE_ENV="development" ; npx tsx prisma/seed.ts
"SELECT count(*) FROM pg_policies;" | docker exec -i orya-audit-pg psql -U audit_admin -d orya_audit -tA   # attendu : 37

# 4. API locale sur port libre, puis script de vérification de l'audit
$env:API_PORT="13001"; $env:JWT_ACCESS_SECRET="<JWT_48o>"; $env:MFA_ENCRYPTION_KEY="<32o_base64>"
$env:CORS_ORIGINS="http://127.0.0.1:13000"; $env:COOKIE_SECURE="false"; $env:AUTH_LOGIN_LIMIT="200"; $env:API_RATE_LIMIT="2000"
Start-Process node -ArgumentList "C:\Users\YEP\Projects\orya\apps\api\dist\main.js" -WorkingDirectory C:\Users\YEP\orya-audit
powershell -File C:\Users\YEP\orya-audit\audit-api.ps1     # attend audit.secrets (PG_ADMIN_PW, OWNER_PW, APP_PW, JWT, MFA, SEED_PW)

# 5. Images Docker (tags d'audit, aucune publication)
cd C:\Users\YEP\Projects\orya
docker build -f deploy/Dockerfile.api --target migrate -t orya-audit-api-migrate:temps-b .
docker build -f deploy/Dockerfile.api -t orya-audit-api:temps-b .
docker build -f deploy/Dockerfile.web --build-arg NEXT_PUBLIC_API_BASE=http://127.0.0.1:13011/api/v1 -t orya-audit-web:temps-b .
# compose.audit.app.yml : services migrate / api (127.0.0.1:13011:3001) / web (127.0.0.1:13010:3000) sur la base orya_audit_docker
docker compose -p orya-audit -f ...\compose.audit.yml -f ...\compose.audit.app.yml --env-file ...\audit.secrets run --rm migrate
docker compose -p orya-audit -f ...\compose.audit.yml -f ...\compose.audit.app.yml --env-file ...\audit.secrets up -d api web

# 6. E2E Playwright (specs du dépôt) contre la pile d'audit
cd e2e ; $env:E2E_WEB_URL="http://127.0.0.1:13010" ; $env:SEED_PASSWORD="<SEED_PW>" ; npx playwright test --reporter=list
#    (charger au préalable apps/api/test/api/seed-attendance.sql et e2e/seed-e2e.sql dans orya_audit_docker via orya-audit-pg)

# 7. Nettoyage (uniquement les ressources de l'audit)
Stop-Process -Id <PID de l'API d'audit>
docker compose -p orya-audit -f ...\compose.audit.yml -f ...\compose.audit.app.yml --env-file ...\audit.secrets down -v
docker rmi orya-audit-api:temps-b orya-audit-api-migrate:temps-b orya-audit-web:temps-b
Remove-Item C:\Users\YEP\orya-audit\audit.secrets
```

**À ne pas lancer en l'état :**
- `apps/api/test/api/run-api-tests.ps1`, `apps/api/test/db/run-db-tests.ps1`, `e2e/run-e2e.ps1`, `scripts/demo-env.ps1`, `scripts/test-backup-restore.ps1` : ils ciblent `orya-postgres` et `localhost:5432`. Attendre P0-2.
- `npm run db:seed:demo` : il cible `orya_v2`.
- `npm run db:down` à la racine.

*Fin du rapport. Fichier unique créé dans le dépôt par cet audit : `docs/audits/ORYA_RAPPORT_GENERAL_AUDIT.md`.*
