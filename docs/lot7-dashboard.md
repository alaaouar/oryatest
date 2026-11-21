# Lot 7 — Tableau de bord direction

Statut : développé et testé (API). Non validé.

## Accès
- `GET /api/v1/dashboard/summary?from=AAAA-MM-JJ&to=AAAA-MM-JJ` et `GET /api/v1/dashboard/export?report=…&format=csv|xlsx&from&to`.
- Rôle `direction` uniquement, second facteur obligatoire (`JwtAuthGuard`, `RolesGuard`, `MfaGuard`, `@RequireMfa`). Enseignant / parent : 403 ; sans jeton : 401.
- Toutes les requêtes passent par `TenancyService.run` (RLS `app.school_id`) ; la liste des enseignants filtre en plus `schoolId`.
- Période par défaut : 30 derniers jours (date civile Africa/Casablanca) ; maximum 92 jours ; dates invalides ou inversées : 400.

## Indicateurs (requêtes réelles, aucune valeur fictive)
| Bloc | Source |
|---|---|
| Élèves, inscrits, sans classe | `Student.count`, `Enrollment.groupBy(classroomId)` sur l'année scolaire courante |
| Appel du jour | `AttendanceSession` du jour (ouvertes / clôturées), `AttendanceRow.groupBy(status)`, classes sans appel |
| Non justifiées | lignes absent/retard de la période moins celles couvertes par un `AbsenceJustification` accepté |
| Enseignants | `groupBy` sur `openedById`, `closedById`, `AgendaItem.authorId`, `Message.authorId` |
| Communications | `Message.groupBy(kind)`, destinataires, lus (`readAt`), accusés (`requiresAck` / `acknowledgedAt`) ; taux `null` si dénominateur 0 |
| En attente | justificatifs `pending` (+ plus ancien), actions familles `open` (+ échéance dépassée) |
| Activité par jour | séances, présences, messages, agenda, justificatifs reçus ; `hasData=false` si rien |

Plafond de sécurité : 20 000 lignes par requête de détail.

## Index (migration non destructive `20261030260000_lot7_dashboard`)
- `Enrollment(schoolId, schoolYear, classroomId)`
- `ParentAction(schoolId, status)`
- `AgendaItem(schoolId, authorId, createdAt)`
Index existants réutilisés : `AttendanceSession(schoolId, date)`, `AttendanceRow(schoolId, sessionId)`, `Message(schoolId, createdAt)`, `AbsenceJustification(schoolId, status)`.

## Exports
- Rapports : `classes`, `today`, `teachers`, `unjustified` (liste complète), `activity`, `communications`.
- CSV UTF-8 avec BOM, séparateur `;` (Excel FR) ; XLSX via exceljs (valeurs, jamais de formules).
- Anti-injection : toute chaîne commençant par `= + - @`, tabulation ou retour chariot est préfixée d'une apostrophe (`src/dashboard/export.ts`, vérifié par `test/api/check-export-escape.cjs`).
- `Cache-Control: private, no-store` ; chaque export écrit `dashboard.exported` dans l'AuditLog (rapport, format, période, nombre de lignes).

## Interface
- `/dashboard` (profil direction) : filtres de période (7 / 30 / 90 j), cartes KPI, appel du jour, effectifs, communications, enseignants, non justifiées (20 plus récentes), activité par jour, boutons CSV/XLSX. États vides explicites.

## Tests
- 29 cas API « L7 » dans `test/api/run-api-tests.ps1` (cohérence des totaux, isolation école B, 403/401, périodes, état vide, exports CSV/XLSX, échappement, audit).

## Reste à faire
- Tests E2E navigateur (lot 10), graphiques plus riches, éventuel cache si volumétrie élevée.
