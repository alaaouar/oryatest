# Lot 2.3 — Interface web des présences

Livré le 30 octobre 2026 sur la branche locale `feature/lot-2.3-attendance-ui` (créée depuis `feature/lot-2.2-attendance`).
Le frontend `apps/web` est branché sur les endpoints réels de `apps/api`. Il n'y a pas de backend parallèle.

## Écrans (apps/web)

| Route | Rôles | Contenu |
|---|---|---|
| `/attendance` | direction, teacher | Classes (enseignant : uniquement les siennes), date, matin / après-midi, état des deux créneaux, ouverture ou reprise de l'appel |
| `/attendance/[sessionId]` | direction, teacher | Liste des élèves inscrits, marquage présent / absent / retard (individuel, sélection, « tous présents », « non marqués → présents »), recherche et filtre, compteurs, enregistrement groupé avec confirmation, clôture (confirmation et alerte si des élèves ne sont pas marqués), réouverture avec motif (direction), historique détaillé |
| `/assignments` | direction | Création et retrait des affectations enseignant-classe par année scolaire (MFA exigée côté API) |

La navigation (`app/(console)/layout.tsx`) affiche « Présences » à la direction et aux enseignants, et « Affectations » à la direction.

Les erreurs API passent par `describeError()` (`lib/api.ts`), qui donne un message en français pour 400, 401, 403, 404, 409, 413, 429, 5xx et les erreurs réseau.
Cas particuliers :
- 409 à l'ouverture : la session existante est reprise automatiquement ;
- 409 à l'enregistrement : l'état réel est rechargé (session clôturée entre-temps).

La saisie non enregistrée est signalée ligne par ligne, et la fermeture de l'onglet est protégée par `beforeunload`.

L'interface est responsive : boutons de statut pleine largeur sur mobile, tableaux empilés, barre d'actions collante, cibles de 44 à 48 px.

## Endpoints ajoutés (apps/api, module `attendance`)

| Méthode | Chemin | Rôles | Règle |
|---|---|---|---|
| GET | `/api/v1/classrooms?schoolYear=` | direction, teacher, super_admin | Enseignant : uniquement ses classes affectées. Renvoie l'effectif et les enseignants affectés. |
| GET | `/api/v1/teachers` | direction, super_admin | Profils enseignants de l'école, sans e-mail. |
| GET | `/api/v1/attendance/sessions?classroomId=&date=&slot=` | direction, teacher, super_admin | Contrôle d'accès à la classe, comme pour l'appel. |
| GET | `/api/v1/attendance/sessions/:id/history` | direction, teacher, super_admin | Historique reconstruit depuis `AuditLog` : auteur, motif, changements par élève (avant → après). |

Le `schoolId` provient toujours du jeton, et la RLS reste active.
Depuis le lot 2.3, `POST …/rows` et `…/rows/bulk` renvoient aussi `changed`. Le journal `attendance.rows.recorded` contient `changes` (200 au maximum par envoi).

## Sécurité (corrections faites au passage)

- CSP et en-têtes de sécurité sur `apps/web` (`next.config.ts`) : `connect-src` limité à l'origine de l'API, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Import CSV/XLSX : une cellule texte qui commence par `= + - @ TAB CR` est refusée, avec une erreur de ligne. Un `.xlsx` sans signature ZIP est refusé (400).
- Migration `20261030200000_lot2_3_attendance_restrict` (non destructive) : `ON DELETE RESTRICT` sur `AttendanceSession.classroomId`, `AttendanceRow.sessionId` et `AttendanceRow.studentId`. Supprimer une classe ou un élève ne peut plus effacer l'historique d'appel. La suppression d'une école reste en cascade.
- La limite de débit globale est configurable (`API_RATE_LIMIT`, 120 par défaut).

## Données de démonstration (base locale orya_v2)

`npm run db:seed:demo` (dans `apps/api`) ajoute de façon additive et idempotente 2 classes à l'école A (6e A : 20 élèves, 5e B : 12 élèves). L'enseignant du seed est affecté à la 6e A.

## Lancer

```powershell
docker compose up -d                 # depuis la racine
cd apps\api
npm run db:deploy                    # applique les migrations sans reset
npm run db:rls
npm run db:seed:demo                 # optionnel : classes et élèves de démonstration
npm run build; npm run start         # API sur http://localhost:3001
# second terminal
cd apps\web
npm run dev                          # http://localhost:3000
```

Comptes du seed (le mot de passe est celui de `SEED_PASSWORD` dans `apps/api/.env`) :
- `direction@ecole-a.orya.test` : direction, MFA ;
- `professeur@ecole-a.orya.test` : enseignant.

## Tests

- `npm run test:api` : 129 succès / 0 échec, dont 20 scénarios lot 2.3 (`T-2.3`).
- `npm test` : contrôles statiques OK.
- `npm run test:db` : T1 à T10b OK, avec la nouvelle migration.
- `apps/web` : `npm run build` et `npm run typecheck` OK. Il n'existe pas encore d'outillage de tests composants ou E2E (Playwright prévu au lot 10).

## Limites connues

- Pas de mode hors ligne (`clientMutationId` est réservé, mais pas encore utilisé par l'UI).
- Jetons toujours en `sessionStorage` : la CSP réduit le risque sans le supprimer. Cible : cookies httpOnly via un BFF.
- `next lint` n'existe plus en Next 16 : le script `lint` est cassé et il n'y a pas de configuration ESLint.
