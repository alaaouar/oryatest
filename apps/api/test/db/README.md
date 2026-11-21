# Tests de base de données — Lot 1

Ces tests vérifient les garanties **au niveau PostgreSQL**, indépendamment de l'API :
isolation par école (RLS), intégrité (maximum deux responsables) et journal d'audit
inaltérable.

## Prérequis

- Docker Desktop démarré, conteneur jetable `orya-test-pg` créé par `scripts/test-pg-up.ps1` (jamais `orya-postgres`) ;
- les rôles `orya_owner` et `orya_app` créés (`prisma/sql/000_roles.sql`) ;
- `SEED_PASSWORD` : inutile, le script en génère un aléatoire pour chaque exécution (jamais affiché).

## Exécution

```powershell
cd C:\Users\YEP\Projects\orya
powershell -ExecutionPolicy Bypass -File .\scripts\test-pg-up.ps1          # cree orya-test-pg (127.0.0.1:55433, volume orya-test-pg-data)
powershell -ExecutionPolicy Bypass -File .\apps\api\test\db\run-db-tests.ps1
powershell -ExecutionPolicy Bypass -File .\apps\api\test\api\run-api-tests.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\test-pg-down.ps1        # supprime orya-test-pg et son volume (etiquette created-by=orya-test verifiee)
```

Les scripts de test ne visent **que** le conteneur jetable `orya-test-pg` (variables
`ORYA_TEST_CONTAINER`, `ORYA_TEST_PORT`, `ORYA_TEST_DB` pour le rediriger vers un autre conteneur
jetable etiquete). La garde `scripts/test-guard.ps1` refuse (code 3), avant toute commande, le
conteneur `orya-postgres`, le port 5432 et les bases `orya`, `orya_v2`, `postgres`, `template0`,
`template1`. `SEED_PASSWORD` est genere aleatoirement pour chaque execution (jamais affiche) et
l'ancienne valeur est restauree en fin de script.

Le script recrée **deux bases jetables** à chaque exécution :

| Base | Contenu | But |
|---|---|---|
| `orya_lot1_rls` | schéma + RLS + fixtures | tests d'isolation T1, T2, T3, T5, T6, T7, T8, T9 |
| `orya_lot1_seed` | schéma + RLS + seed | idempotence du seed (exécuté deux fois) |

**La base de développement `orya` n'est jamais touchée.** Les deux bases jetables
peuvent être supprimées à tout moment :

```sql
DROP DATABASE orya_lot1_rls WITH (FORCE);
DROP DATABASE orya_lot1_seed WITH (FORCE);
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `verify.sql` | fixtures + assertions T1…T9 ; échoue avec un message explicite |
| `count.sql` | compteurs attendus après seed : 3 écoles, 13 comptes, 13 profils, 6 élèves, 6 responsables, 12 liens, 12 consentements |
| `state.sql` | vérifie que chaque table métier a `rls_active = t` et `force_rls = t` |
| `run-db-tests.ps1` | orchestration des deux bases |

## Résultat attendu

```
T1 OK — école A ne voit que ses 2 élèves et ses 2 liens
T2 OK — 0 ligne visible sans contexte d'école
T3 OK — écriture dans une autre école refusée par la policy
T5 OK — école B ne voit que son élève et aucun lien de A
T6 OK — troisième responsable refusé (ORYA_MAX_GUARDIANS)
T7 OK — modification du journal d'audit refusée (ORYA_AUDIT_IMMUTABLE)
T8 OK — DROP TABLE refusé au rôle applicatif
T9 OK — orya_app ne peut pas modifier le journal d'audit
=== TOUS LES TESTS SONT PASSES ===
```

## Ce que ces tests ne couvrent pas

Les tests T4, T10 à T13 du plan dépendent de l'API (authentification, rôles,
révocation de session) et seront ajoutés avec le module `auth`.
