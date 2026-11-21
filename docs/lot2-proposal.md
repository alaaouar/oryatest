# Lot 2 — « Cœur scolaire » : découpage proposé

Statut : **2.1 et 2.2 livrés le 30 octobre 2026** ; 2.3 (hors ligne) reporté ;
2.4–2.5 en attente. Voir `docs/lot2-2-attendance.md` et `docs/PROJECT_STATUS.md`.

Périmètre du lot (CDC §16) : import des listes, appel hors ligne, justificatifs,
cartes « À faire », notifications.

## 1. Dépendance structurelle à trancher d'abord

Le CDC place l'appel **hors ligne** et les **push** dans le parcours enseignant et
parent, donc sur **mobile Flutter**. Or Flutter a été placé au **Lot 5** par
arbitrage. Deux options, exclusives :

| | Option A — socle prêt maintenant | Option B — report au Lot 5 |
|---|---|---|
| Appel hors ligne | serveur prêt (idempotence, conflits) **+ PWA minimale** dans la console | appel **en ligne seulement** au Lot 2 |
| Push | outbox + centre in-app | outbox + in-app, FCM/APNs au Lot 5 |
| Effort Lot 2 | +1 sous-lot, +1 migration (`SyncConflict`) | plus léger, mais l'exigence CDC reste non tenue |
| Risque | PWA à maintenir en parallèle de Flutter | l'hors ligne arrive après 3 lots |

Recommandation : **Option A, limitée à l'appel** (la PWA ne couvre que la saisie
d'appel, pas le reste de la console).

## 2. Sous-lots

### 2.1 Import Excel / CSV — priorité 1

- Upload 5 Mo / 5 000 lignes maximum ; aperçu **avant** écriture.
- Rapport d'erreurs **ligne par ligne** : numéro de ligne, colonne, motif.
- Colonnes : classe, niveau, nom, code élève, code Massar, responsables, date de
  naissance (optionnelle).
- Idempotence : réimport = mise à jour, jamais de doublon (clé : école + code élève ;
  code Massar conservé).
- Migration : `Classroom`, `Enrollment`, `ImportJob`, `ImportRowError`.
- Endpoints : `POST /imports`, `GET /imports/:id`, `POST /imports/:id/commit`,
  `POST /imports/:id/cancel`.
- Tests : fichier de 400 lignes, 3 lignes invalides listées, réimport sans doublon,
  import d'un fichier d'une autre école refusé.

### 2.2 Appel — sessions par demi-journée

- Migration : `AttendanceSession` (date, créneau `morning`/`afternoon`, classe,
  clôturée le, clôturée par) et `AttendanceRow` (statut, `version`, `recordedAt`,
  `recordedBy`).
- Endpoints : ouvrir une session, enregistrer les lignes (idempotent), clôturer
  (audit), rouvrir (audit, motif obligatoire).
- Règles : une session clôturée refuse toute écriture (409) sauf réouverture
  explicite ; chaque réouverture est auditée.
- Tests : 30 élèves, double envoi sans doublon, écriture après clôture refusée,
  réouverture tracée.

### 2.3 Hors ligne (Option A) — protocole de synchronisation

- Chaque saisie porte un `clientMutationId` (UUID généré côté client) : le serveur
  déduplique, donc un renvoi réseau ne crée pas de doublon.
- Envoi par lot (`POST /attendance/sessions/:id/rows:bulk`), réponse détaillée
  ligne par ligne (acceptée, ignorée, en conflit).
- **Règle de conflit retenue** : par ligne, la version serveur gagne si
  `updatedAt(serveur) > recordedAt(client)`, sinon le client gagne. Chaque
  désaccord écrit une ligne `SyncConflict` (valeur serveur, valeur client,
  horodatages) et l'enseignant voit un écran « conflits à arbitrer ».
  Cette règle sera figée dans un ADR.
- Tests : mode avion simulé (file locale), reconnexion, aucune perte, conflit
  arbitrable.

### 2.4 Justificatifs et pièces jointes

- Motif + texte + pièce jointe **10 Mo max**, types PDF/JPG/PNG/HEIC.
- Stockage **privé** ; URL signée à durée courte (5 min) ; aucune URL publique.
- **Antivirus** : statut `pending` / `clean` / `infected` ; un fichier infecté est
  refusé et purgé. Recommandation : **ClamAV en conteneur** (`clamav/clamav`),
  cohérent avec le `docker-compose` existant.
- Migration : `AbsenceJustification`, `Attachment` (hash, mime, taille, clé de
  stockage, statut de scan).
- Tests : 10 Mo accepté, 11 Mo refusé, type interdit refusé, URL expirée, fichier
  infecté rejeté (fixture EICAR en CI).

### 2.5 Cartes « À faire » et notifications

- Migration : `ActionItem`, `NotificationOutbox`, `NotificationPreference`.
- Cartes : justifier une absence, confirmer une réunion, accuser réception ;
  maximum 5 affichées, le reste dans « Fait ».
- Notifications : écriture dans l'**outbox** à la clôture d'appel, consommation par
  le centre in-app ; aucune dépendance à un fournisseur externe tant que Flutter
  n'est pas là.
- Tests : carte créée à la clôture, parent voit ≤ 5 cartes, notification in-app
  reçue, préférence respectée.

## 3. Ordre et dépendances

```
2.1 import  ──►  2.2 appel  ──►  2.3 hors ligne (si Option A)
                      │
                      ├──► 2.4 justificatifs  ──►  (lien avec cartes)
                      └──► 2.5 cartes + notifications
```

Chaque sous-lot = une migration, un jeu de tests, un commit. Aucun sous-lot n'est
ouvert avant que le précédent ne soit vert.

## 4. Décisions demandées

1. **Hors ligne** : Option A (PWA maintenant) ou Option B (Lot 5) ?
2. **Push** : in-app seulement au Lot 2 (recommandé), ou FCM web dès maintenant ?
3. **Antivirus** : ClamAV en conteneur (recommandé) ou report au durcissement ?
4. **Dépendances** : accord pour `exceljs` + `csv-parse` (import) et l'image
   `clamav/clamav` (scan) ?

## 5. Ce qui ne sera pas fait dans ce lot

Paiement (Lot 6), application Flutter (Lot 5), transport (Lot 5), notes et
bulletins (hors périmètre, Massar), assistant IA (hors périmètre).
