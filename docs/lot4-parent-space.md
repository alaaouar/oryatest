# Lot 4 — Espace parents

Branche locale : `feature/lot-4-parent-space` (créée depuis `feature/lot-3-students-families`). Rien n'est poussé sur GitHub.

## Stockage privé (décision d'Ayoub)

- `src/storage/` : `StorageService` (validation + écriture) au-dessus d'un `StorageDriver`.
- Pilote `local` (développement) : dossier `STORAGE_LOCAL_DIR` (chemin absolu, hors dépôt et hors racine web). Par défaut `%TEMP%/orya-private-storage` hors production ; **obligatoire en production**.
- Clé générée par le serveur : `<schoolId>/<64 hex aléatoires>`. Aucun nom fourni par le client n'entre dans le chemin ; contrôle anti-traversée.
- Contrôles : taille (`UPLOAD_MAX_BYTES`, 5 Mo), type réel par magic bytes (PDF, JPEG, PNG), extension cohérente avec le contenu, SHA-256 conservé.
- Aucune URL publique : le fichier est servi uniquement en flux par l'API après autorisation, avec `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `nosniff`, CSP `sandbox`. Le jeton reste dans l'en-tête (jamais dans l'URL).
- Pilote `s3` : interface en place (`s3.driver.ts`), **non implémentée**. Cible documentée : bucket privé, Block Public Access, SSE-KMS, lecture en flux, cycle de vie pour la rétention. Aucun service payant connecté.

## Modèle (migration non destructive `20261030230000_lot4_parent_space`)

`StoredFile`, `AbsenceJustification` (pending/accepted/rejected), `Notification`, `ParentAction` (open/done/cancelled). RLS par école sur les quatre tables (`010_rls.sql`), contrôle statique tenancy étendu.

## API

| Route | Rôle | Effet |
|---|---|---|
| `GET/POST /family/justifications` | parent | Liste / dépôt (enfant rattaché sinon 404 ; période ≤ 31 jours) |
| `GET /family/justifications/:id/file` | parent | Fichier de ses propres envois uniquement |
| `GET /family/actions`, `POST /family/actions/:id/done` | parent | Demandes de l'école |
| `GET /family/children/:id` | parent | Absences/retards marqués `justified` si couverts par un justificatif accepté |
| `GET /justifications?status`, `GET /justifications/:id/file` | direction | Examen |
| `POST /justifications/:id/review` | direction + MFA | accepted / rejected (motif obligatoire), 409 si déjà examiné, audit + notification |
| `GET/POST /parent-actions`, `POST /parent-actions/:id/cancel` | direction (+ MFA en écriture) | Demande aux familles, notifie les comptes parents liés |
| `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | rôles d'école | Seulement les notifications du compte |

Audit (entité `Student`, visible dans l'historique de la fiche) : `student.justification.submitted|accepted|rejected`, `student.parent_action.created|completed|cancelled`.

## Web

- `/family` (parent, mobile d'abord) : onglets Enfants (absences, badge « Justifié », bouton « Justifier »), Justificatifs (formulaire + suivi + pièce jointe), À faire.
- `/justifications` (direction) : filtre par statut, téléchargement, accepter / refuser avec note.
- Fiche élève : section « Demandes aux familles ».
- `/notifications` + compteur de non-lues dans la navigation.

## Non livré (volontairement)

- Agenda, devoirs, communications : pas de backend → rien d'affiché ; lots 5 et 6.
- Notification automatique lors d'une absence, e-mail/SMS : lot 5.
- Rétention/purge et chiffrement au repos : avec le pilote S3 (lot 10).

## Tests

- `npm run test:api` : 201 assertions, 0 échec (34 nouvelles T-4 : enfant d'une autre famille 404, autre école 404, fichier d'un autre parent 404, anonyme 401, exécutable déguisé et extension incohérente 400, période et formule 400, enseignant/parent 403 sur l'examen, double examen 409, notifications d'un autre compte 404, actions).
- `npm run test:db`, `npm test` (statique), web `typecheck` + `build` : OK.
