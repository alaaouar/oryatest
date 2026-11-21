# Lot 3 — Élèves et familles

Branche locale : `feature/lot-3-students-families` (créée depuis `feature/lot-2.3-attendance-ui`). Rien n'est poussé sur GitHub.

## API (apps/api)

| Route | Rôles | Rôle |
|---|---|---|
| `GET /students?search&classroomId&schoolYear&unassigned` | direction, enseignant, super-admin | Liste avec classe courante et nombre de responsables |
| `GET /students/:id/profile` | direction, enseignant | Fiche : inscriptions, responsables (coordonnées masquées pour l'enseignant), présences, historique |
| `PATCH /students/:id` | direction + MFA | Nom, date de naissance, code Massar (changement tracé) |
| `POST /students/:id/enrollment` | direction + MFA | Affectation / changement de classe (POST car CORS sans PUT) |
| `GET/POST /guardians`, `GET/PATCH /guardians/:id` | direction (+ MFA en écriture) | Responsables et coordonnées |
| `POST /guardians/:id/students`, `DELETE /guardians/:id/students/:studentId` | direction + MFA | Liens, plusieurs enfants, 2 responsables max par élève (409) |
| `POST /guardians/:id/invitation` | direction + MFA | Invitation parent (e-mail requis, au moins un enfant, pas de compte existant) ; jeton affiché une fois |
| `POST /imports` avec `kind: "guardians"` | direction + MFA | Import 2.1b : même aperçu/validation/annulation, garde formules, signature XLSX |
| `GET /family/children`, `GET /family/children/:id` | parent | Uniquement les enfants rattachés au compte ; sinon 404 |

- L'acceptation d'une invitation parent (`POST /activation/invitation`, code existant) rattache le compte au responsable (`Guardian.userId`), donc à tous ses enfants.
- Import responsables : un code élève inconnu devient une erreur de ligne ; un responsable est réutilisé (même e-mail, ou nom + téléphone, ou nom déjà lié à l'élève) ; les lignes qui dépasseraient 2 responsables sont ignorées et rapportées.
- Toutes les requêtes passent par `TenancyService` (RLS par école) ; toutes les écritures sont journalisées.

Migration non destructive `20261030210000_lot3_families` : `ImportJob.kind` (défaut `students`), `Guardian.address`, `Guardian.phoneSecondary`, deux index. Appliquée sur `orya_v2` le 30/10/2026.

## Web (apps/web)

- `/students` : liste, recherche, filtre classe.
- `/students/[id]` : fiche, modification, changement de classe, responsables (rattacher/détacher), code d'activation, présences, historique.
- `/families` : CRUD responsables, coordonnées, enfants rattachés, invitation (lien affiché une fois).
- `/imports` : import élèves ou responsables, aperçu et erreurs par ligne.
- `/activation` (public) : lien d'invitation `?token=` ou code école + code d'activation.
- `/family` : espace parent « Mes enfants ».
- Navigation selon le rôle.

## Tests

- `npm run test:api` : 167 assertions, 0 échec (dont 38 nouvelles T-3 : isolation école B, 403 enseignant/parent, 409 doublons et 3e responsable, invitation → activation → enfants visibles, import responsables).
- `npm run test:db` : RLS et seed vérifiés.
- `npm test` (statique) : tenancy et encodage OK.
- Web : `npm run typecheck` et `npm run build` OK.
- Non couvert : tests E2E navigateur (lot 10).
