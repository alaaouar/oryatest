# Bloc 3 - durcissement prealable (points 1 a 5)

Demande d'Ayoub apres acceptation du bloc 2. Chaque point est teste dans `apps/api/test/api/run-bloc2-tests.ps1` (lance par `scripts/verify-all.ps1`).

## 1. Copie append-only du registre des suppressions hors base

- `apps/api/src/account/deletion-register.ts` : a chaque anonymisation (job), l'entree du registre est ecrite en base **et** ajoutee au journal `DELETION_REGISTER_JOURNAL` (chemin absolu, fichier JSONL ouvert en mode ajout puis `fsync`), dans la transaction : si l'ecriture du journal echoue, l'anonymisation est annulee (echec ferme).
- Chaque ligne est chainee (`prev` + `mac` = HMAC-SHA256 de la ligne et du mac precedent) : modifier ou retirer une ligne rompt la chaine, le rejeu refuse alors le journal.
- Rejeu apres restauration : `apps/api/prisma/run-replay-register.ts` (ou `scripts/restore-db.ps1 -Replay`) reinsere en base les entrees du journal absentes (sauvegarde anterieure a la suppression), puis re-anonymise tout compte ou eleve dont l'empreinte figure au registre.
- Production : journal sur un volume distinct de la base, attribut append-only (`chattr +a`) ou stockage objet WORM (Object Lock), sauvegarde separee de celle de la base. Non teste ici (poste Windows).

## 2. emailHash : SHA-256 simple -> HMAC-SHA256

- Constat : au bloc 2, `emailHash = sha256(lower(email))` sans sel ni cle (retrouvable par dictionnaire d'e-mails).
- Desormais : `HMAC-SHA256(DELETION_REGISTER_HMAC_KEY, valeur)` pour emailHash, userIdHash, studentIdHash, schoolIdHash. Cle >= 32 octets (base64), secret d'environnement hors base, jamais journalisee ; generee aleatoirement a chaque run de test.
- Lignes existantes : impossibles a convertir (l'e-mail d'origine n'existe plus). Le rejeu reconnait les deux formes (HMAC et SHA-256 historique) ; aucune nouvelle ligne SHA-256 n'est ecrite. Migration de donnees : aucune ; pilote non ouvert, donc aucune ligne historique attendue en production.
- Rotation de cle : non prevue (une nouvelle cle rend les anciennes empreintes HMAC non reconnaissables) ; a conserver dans le coffre de secrets avec la sauvegarde.

## 3. runSystem / runPublic hors HTTP

- `apps/api/test/static/check-system-contexts.mjs` (T15, `npm test`) : appels seulement dans des methodes d'entree job/CLI listees, entrees appelees seulement depuis `*.job.ts` et `prisma/run-*.ts`, aucun controleur ; auto-test sur 5 pieges.
- Constat corrige : `GET consent-texts/current` appelait `runPublic`. Il utilise maintenant `runIdentity(auth.userId)` ; la policy `consent_text_read` n'expose plus que les textes valides (brouillons : super-admin).

## 4. Validation d'un texte de consentement

- `POST admin/consent-texts/validate` : super-admin, `@RequireMfa()` et controle `auth.mfa`, corps `{ id, legalDocumentRef, legalValidatedAt }` (date non future).
- Enregistre `legalDocumentRef`, `legalValidatedAt`, `validatedById` ; CHECK SQL : un texte valide porte toujours reference et date ; trigger : plus rien ne change apres validation (hors `retiredAt`).
- Audit `consent.text.validate`, gravite critique, metadonnees reference + date.

## 5. CONSENT_REQUIRE_ALL_LINKED_GUARDIANS : decision juridique avant le pilote

**A trancher par le juriste avant l'ouverture du pilote.** Valeur actuelle par defaut : `0` (un consentement actif d'un responsable, ou l'accord papier de la direction, suffit a activer le compte eleve). Avec `1`, chaque responsable lie a un compte doit consentir ; le retrait d'un seul suspend le compte.
Question posee : pour un mineur, l'accord d'un seul titulaire de l'autorite parentale suffit-il (acte usuel) ou faut-il l'accord de tous les responsables lies ? La decision doit etre consignee (document + date) puis la variable fixee dans la configuration de production ; elle reste inversable sans migration.