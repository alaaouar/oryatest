# Lot 10 — Finalisation et préparation du lancement

Statut : **Développé et testé localement** (à valider par Ayoub — jamais marqué « Validé » par l'agent).

| # | Élément | Livrable | Vérification |
|---|---|---|---|
| 1 | Tests SQL RLS lot 9 | `apps/api/test/db/verify.sql` (L9-1 à L9-8) | `npm run test:db` vert |
| 2 | E2E Playwright | `e2e/` (prof, parent mobile Pixel 7, direction), `run-e2e.ps1` sur `orya_e2e` | 4/4 verts (Chromium) |
| 3 | Cookies httpOnly + CSRF | `orya_at` / `orya_rt` / `orya_csrf`, SameSite=Strict, en-tête `X-CSRF-Token` ; Bearer conservé hors navigateur | 10 tests API L10-C ; E2E vérifie qu'aucun jeton n'est lisible en JS |
| 4 | États erreur / chargement | `app/(console)/error.tsx`, `loading.tsx`, `app/not-found.tsx` | build web OK ; audit responsive limité au parcours E2E mobile parent |
| 5 | Vulnérabilités npm | overrides `multer ^2.5.0`, `uuid ^11.1.1` | restent 3 « high » `deepmerge-ts` (CLI Prisma) → montée Prisma 7 documentée, non faite |
| 6 | Sauvegarde / restauration | `scripts/backup-db.ps1`, `restore-db.ps1`, `test-backup-restore.ps1` | `orya_e2e` → `orya_restore_test` : comptages et 37 policies identiques ; refus de `orya_v2` testé |
| 7 | Préparation déploiement | `deploy/Dockerfile.api`, `Dockerfile.web`, `docker-compose.prod.example.yml`, `env.prod.example` | non construit ni déployé (aucun hébergeur choisi) |
| 8 | Démo | `scripts/demo-env.ps1` → `orya_demo`, écoles `[DEMO] …` | 3 écoles, 36 élèves, rôle sans bypass RLS |
| 9 | Documentation | `docs/guides/guide-{direction,professeur,parent}.md`, `docs/technique-exploitation.md` | relecture Ayoub |
| 10 | Checklist pilote | `docs/CHECKLIST_LANCEMENT_PILOTE.md` | cases à cocher par Ayoub |

## Limites connues
- Dockerfiles non testés par un `docker build` (à faire avant mise en ligne).
- Audit responsive : pas de revue écran par écran sur toutes les pages direction.
- Pas de test de charge / performance.
