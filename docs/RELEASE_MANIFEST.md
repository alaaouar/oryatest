# ORYA - Manifeste de version (local, non publie)

Genere par `scripts/make-release-manifest.ps1`. Decrit le commit ci-dessous ; a regenerer a chaque version.

| Element | Valeur |
|---|---|
| Commit | `e660239584037ba078e466fc9317e0233ed3f192` |
| Branche | `platform-main` |
| Date du commit | 2026-11-05T01:17:31Z |
| Tag des images | `e66023958403` (`scripts/build-images.ps1`) |

## Images locales pour ce commit

| Image | ID |
|---|---|
| `orya-api:e66023958403` | `non construite` |
| `orya-api-migrate:e66023958403` | `non construite` |
| `orya-web:e66023958403` | `non construite` |

## Historique recent

- `e660239` fix(ops): create-super-admin conforme au tsconfig API (noUncheckedIndexedAccess)
- `0a6b871` docs: RELEASE_MANIFEST regenere sans BOM (decrit 89cfc70, parent de ce commit)
- `89cfc70` docs: matrice de conformite CDC v2.0 + Avenant n1 (statut et preuve par section, mise a jour a chaque commit de fonctionnalite)
- `51f3ec3` docs: P0-8b TRUST_PROXY_HOPS dans la procedure de premier deploiement (valeur par hebergement, methode de controle)
- `6306197` test: P0-8b rejeu du premier deploiement sur conteneur jetable vierge (orya-test-fd), 28 controles, etape verify-all
- `6431c67` feat(ops): P0-8b outil de creation du premier super-administrateur sans seed (saisie masquee, MFA impose, audite, refus si existant)
- `6cb7c1f` chore: port par defaut de l'API 3001 -> 3200 (main.ts, Dockerfile, compose, env exemples, web, README)
- `494eee1` chore: P0-9 exclusion du prototype legacy racine (tsconfig racine vide, db:up/db:down retires, LEGACY.md ; aucun fichier supprime)
- `f3b9976` docs: P0-8 procedure de premier deploiement (base detenue par orya_owner, test de propriete orya_auth)
- `a86e3e2` build: P0-7 images de production sans seed ni SQL de demo (runtime: schema seul; web: copie elaguee)
- `0d8cfb2` feat: P0-6 retrait des canaux SMS et WhatsApp (API, DTO, web), canaux = in_app + email
- `2e3a63d` feat(api): P0-5 carte A faire (justifier l'absence/le retard) a la cloture de l'appel, idempotente
- `b2e6636` feat(api): P0-4 trust proxy a nombre de sauts exact (TRUST_PROXY_HOPS, 1 par defaut) et /health hors limite de debit, 5 tests
- `1f7c270` test: scripts/verify-all.ps1 (orya-test-pg, statiques, tsc, lint, builds, suites DB/API/E2E/sauvegarde, recapitulatif unique)
- `93fe157` fix(docs): make-release-manifest tolere une image absente ; manifeste regenere sans BOM

## Verification

`powershell -ExecutionPolicy Bypass -File .\scripts\verify-all.ps1` (orya-test-pg uniquement).
