# Lot 6 — Agenda et devoirs

Branche locale : `feature/lot-6-agenda-homework` (créée depuis `feature/lot-5-communication`). Travail écrit et commité directement sur le dépôt du PC, par points d'étape. Rien n'est poussé sur GitHub.

## Modèle (migration non destructive `20261030250000_lot6_agenda`)

- `AgendaItem` : `kind` (homework, test, class_event, important_date), `classroomId` (nul = date d'école), `date` (échéance), `description`, `cancelledAt` (annulation sans suppression).
- `AgendaAttachment` : lien vers `StoredFile` (stockage privé du lot 4).
- RLS par école sur les deux tables ; contrôle statique tenancy étendu.
- Événements d'école : **pas de nouvelle table**. Les `Message` de type `event` (lot 5) sont lus et fusionnés dans le calendrier.

## API

| Route | Rôles | Règles |
|---|---|---|
| `GET /agenda?from&to&classroomId` | direction (tout), enseignant (ses classes + dates d'école) | 403 sur une classe non affectée ; inclut les événements du lot 5 |
| `POST /agenda` | direction (MFA), enseignant affecté | Date d'école réservée à la direction ; pièces jointes PDF/JPEG/PNG (taille, magic bytes) ; notification in-app des parents pour devoirs/contrôles |
| `GET /agenda/:id` | idem | Détail + historique d'audit (avant / après) |
| `PATCH /agenda/:id`, `POST /agenda/:id/cancel`, `POST /agenda/:id/attachments` | auteur autorisé | 409 si annulé ; 3 pièces jointes max |
| `GET /agenda/:id/attachments/:aid/file` | équipe | Flux privé, `attachment`, `no-store` |
| `GET /family/agenda`, `GET /family/agenda/:id`, fichier | parent | Classes de ses enfants + dates d'école ; entrée annulée ou autre classe : 404 |

Audit (entité `AgendaItem`) : `agenda.created`, `agenda.updated` (métadonnées `changes` : from / to), `agenda.cancelled`, `agenda.attachment.added`.

## Web

- `/agenda` (direction, enseignant) : publication (type, classe, échéance, description, pièces jointes) et calendrier sur 30 jours avec filtre de classe.
- `/agenda/[id]` : modification, annulation, ajout de pièce jointe, historique.
- `/family/agenda` (parent, mobile d'abord) : calendrier par quinzaine ; `/family/agenda/[id]` : détail et téléchargement.
- Navigation : entrées « Agenda » ; correction du surlignage (« Mes enfants » ne s'allume plus sur Messages ni Agenda).

## Tests

- `npm run test:api` : 258 assertions, 0 échec (25 nouvelles T-6 : enseignant hors classe 403, date d'école par enseignant 403, autre école 404, parent d'une autre classe 404 sur détail et fichier, exécutable refusé, historique avant/après, annulation et 409, événements du lot 5 fusionnés, notification).
- `npm run test:db`, `npm test`, web `typecheck` + `build` : OK.

## Non livré

- Pièces jointes aux messages du lot 5 : non faites (migration, endpoints et tests supplémentaires ; à planifier).
- Rendu des devoirs par les élèves, notes : hors périmètre du cahier des charges actuel.
