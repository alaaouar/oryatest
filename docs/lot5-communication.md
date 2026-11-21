# Lot 5 — Communication école-famille (in-app)

Branche locale : `feature/lot-5-communication` (créée depuis `feature/lot-4-parent-space`). Rien n'est poussé sur GitHub.

## Modèle (migration non destructive `20261030240000_lot5_communication`)

- `Message` : `kind` (announcement, event, class_message, direct), `audience` (school, classroom, student), `important`, `requiresAck`, `eventAt`/`eventLocation`, auteur et rôle.
- `MessageRecipient` : un compte parent par message (unique), `readAt`, `acknowledgedAt`.
- `MessageReply` : historique des échanges individuels.
- RLS par école sur les trois tables ; contrôle statique tenancy étendu.

Destinataires : uniquement les comptes parents actifs rattachés aux élèves visés (un parent de deux enfants ne reçoit qu'une fois). Un responsable sans compte ne reçoit rien ; l'écran d'envoi l'indique.

## Canaux (`src/channels/`)

- Interface `NotificationChannel` + `NotificationDispatcher` (l'in-app est toujours utilisé).
- `InAppChannel` : réel (table `Notification`, même transaction).
- `EmailChannel`, `SmsChannel`, `WhatsAppChannel` : désactivés. Ils renvoient `status: "not_configured"`, `delivered: 0` et ne contactent rien. Aucun fournisseur payant n'est branché.
- `GET /messages/channels` expose l'état ; le rapport d'envoi est renvoyé et audité.

## API

| Route | Rôles | Règles |
|---|---|---|
| `POST /messages` | direction (MFA), enseignant | Enseignant : ses classes ou un élève de ses classes, jamais toute l'école (403) ; type/public cohérents (400) ; événement daté |
| `GET /messages`, `GET /messages/:id` | direction (tout), enseignant (ses messages) | Compteurs et suivi lecture/accusé par parent ; sinon 404 |
| `POST /messages/:id/replies` | auteur ou direction | Échanges individuels uniquement |
| `GET /family/messages`, `GET /family/messages/:id` | parent | Ses messages ; l'ouverture vaut accusé de lecture ; sinon 404 |
| `POST /family/messages/:id/ack` | parent | Uniquement si un accusé est demandé (400 sinon) |
| `POST /family/messages/:id/replies` | parent | Échanges individuels uniquement |

Clôture d'un appel (`POST /attendance/sessions/:id/close`) : notification in-app aux parents (avec compte) des élèves absents ou en retard ; réponse `familiesNotified`. Une réouverture puis une nouvelle clôture ne crée pas de doublon.

Audit : `message.sent` (avec le rapport des canaux), `message.replied`, `message.acknowledged`.

## Web

- `/messages` (direction, enseignant) : rédaction (type, public, important, accusé, événement, canaux externes affichés « Non configuré ») et liste des envois avec lus/accusés.
- `/messages/[id]` : suivi par parent et échange.
- `/family/messages` (parent, mobile d'abord) : Tous / À lire / Événements ; `/family/messages/[id]` : lecture, « J'ai pris connaissance », réponse.

## Tests

- `npm run test:api` : 233 assertions, 0 échec (32 nouvelles T-5 : canaux non configurés sans envoi simulé, enseignant hors de ses classes 403, autre école 404, parent d'une autre classe 404, accusés, échanges, notification d'absence sans doublon).
- `npm run test:db`, `npm test`, web `typecheck` + `build` : OK.

## Hors périmètre

E-mail/SMS/WhatsApp réels (choix et validation d'un fournisseur), pièces jointes aux messages (lot 6, même stockage privé), modération et archivage.
