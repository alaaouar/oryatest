# ORYA — état du projet

Dernière mise à jour : **30 octobre 2026** (livraison Lot 2.2).

## État général

| Élément | Statut |
|---|---|
| Produit | SaaS B2B écoles privées marocaines |
| Backend de référence | `apps/api` (NestJS `/api/v1`) |
| Frontend de référence | `apps/web` (console Next.js) |
| Base de référence | `orya_v2` (PostgreSQL + RLS) |
| Maquette racine `src/` / `prisma/` | historique — **ne pas y développer** |
| Ancienne base `orya` | intacte — **ne pas migrer** |

## Lots

| Lot | Statut | Notes |
|---|---|---|
| 1 Fondations | **Terminé et testé** | Auth Argon2id, MFA, refresh, activation, RLS, audit, console |
| 2.1 Import CSV/XLSX | **Terminé et testé** | Stabilisé le 30/10 (400/413/Massar) |
| 2.1b Responsables + UI import | Non développé | Hors périmètre immédiat |
| 2.2 Présences / appel | **Terminé et testé** | Affectations, sessions, clôture/réouverture |
| 2.3 Hors ligne | Reporté | `clientMutationId` réservé en schéma |
| 2.4 Justificatifs | Non commencé | |
| 2.5 Cartes + notifications | Non commencé | |
| 5 Mobile Flutter | Non commencé | |
| 6 Paiement | Non commencé | |

## Fonctionnalités terminées et testées (Lot 2.2)

- Affectation enseignant-classe (CRUD direction)
- Ouverture de session (école, classe, date, morning/afternoon)
- Prévention des doublons de session
- Roster des inscrits ; enregistrement individuel et groupé (présent/absent/retard)
- Clôture ; refus d'écriture après clôture (409)
- Réouverture direction avec motif obligatoire + AuditLog
- Isolation multi-écoles + RLS (20 policies)
- Refus enseignant sur classe non affectée

## En cours / non développé

- UI console pour l'appel et les affectations
- Synchronisation hors ligne / conflits
- Import des responsables légaux
- Cookies httpOnly (dette documentée)
- Application mobile

## Tests (dernière exécution locale)

| Suite | Résultat |
|---|---|
| `npm test` (statique) | PASS |
| `npm run test:db` | PASS (RLS + seed + T10 attendance) |
| `npm run test:api` | **109 / 109 PASS** |

## Anomalies ouvertes

- Jetons en `sessionStorage` (dette XSS) — migration cookies httpOnly reportée
- Vulnérabilités npm : Prisma 6 / deepmerge-ts (high, CLI) ; exceljs→uuid (moderate)
- Index PostgreSQL long tronqué historiquement (corrigé `TeacherAssignment_…`)

## Prochaines tâches prioritaires

1. Centraliser le code sur GitHub privé (`orya-platform` ou dépôt existant) après auth `gh`
2. PR de revue Lot 2.1 + 2.2 (pas de merge auto sur `main`)
3. Décider du sous-lot 2.1b vs démarrer 2.4 / UI appel
4. Planifier Prisma 7 pour corriger les vulns CLI
