# Lot 2.2 — Gestion des présences

Livré le 30 octobre 2026. Backend uniquement (`apps/api`).

## Modèles

- `TeacherClassroomAssignment` — unicité `(schoolId, teacherProfileId, classroomId, schoolYear)`
- `AttendanceSession` — unicité `(schoolId, classroomId, date, slot)` ; `slot` ∈ {morning, afternoon}
- `AttendanceRow` — unicité `(sessionId, studentId)` ; `clientMutationId` nullable (hors ligne futur)

## Endpoints

| Méthode | Chemin | Rôles |
|---|---|---|
| GET | `/api/v1/assignments` | direction, teacher, super_admin |
| POST | `/api/v1/assignments` | direction, super_admin (+ MFA) |
| DELETE | `/api/v1/assignments/:id` | direction, super_admin (+ MFA) |
| GET | `/api/v1/attendance/classrooms/:id/roster?date=` | direction, teacher, super_admin |
| POST | `/api/v1/attendance/sessions` | direction, teacher, super_admin |
| GET | `/api/v1/attendance/sessions/:id` | idem |
| POST | `/api/v1/attendance/sessions/:id/rows` | idem |
| POST | `/api/v1/attendance/sessions/:id/rows/bulk` | idem |
| POST | `/api/v1/attendance/sessions/:id/close` | idem |
| POST | `/api/v1/attendance/sessions/:id/reopen` | direction, super_admin |

Le `schoolId` vient exclusivement du jeton.

## Lancer / tester

```powershell
cd apps\api
docker compose up -d   # depuis la racine du dépôt
npm run db:migrate
npm run db:rls
npm run db:seed
npm run build
npm test
npm run test:db
npm run test:api
```

## Suite

Interface web et endpoints de lecture complémentaires : voir `docs/lot2-3-attendance-ui.md`.
