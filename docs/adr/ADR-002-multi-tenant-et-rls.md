# ADR-002 — Isolation multi-tenant par RLS PostgreSQL

**Date :** 29 octobre 2026
**Statut :** accepté
**Exigences couvertes :** CDC §4 M1, §8 S-1, §12, §15 (« trois écoles sans fuite »)

## Contexte

Le CDC exige deux niveaux d'isolation : un identifiant d'école sur chaque table métier
**et** du Row Level Security PostgreSQL. Le code de la maquette ne filtrait que par une
constante applicative (`al-nour`), ce qui ne protège de rien.

## Décision

### 1. Deux rôles PostgreSQL

| Rôle | Attribut | Usage |
|---|---|---|
| `orya_owner` | `BYPASSRLS` | propriétaire des tables, migrations, seed, application des policies |
| `orya_app` | `NOBYPASSRLS` | rôle de l'API à l'exécution, soumis au RLS |

Le seed et les migrations se connectent avec `DIRECT_DATABASE_URL` (`orya_owner`).
L'API se connecte avec `DATABASE_URL` (`orya_app`).

### 2. Trois variables de contexte, posées par transaction

```sql
SELECT set_config('app.school_id',      '<uuid ou chaîne vide>', true);
SELECT set_config('app.user_id',        '<uuid>',               true);
SELECT set_config('app.is_super_admin', 'on' | 'off',           true);
```

Le troisième argument `true` rend la valeur **locale à la transaction**. C'est
obligatoire : un `SET` global fuirait d'une requête à l'autre à travers le pool de
connexions et provoquerait exactement la fuite inter-écoles que le CDC interdit.

### 3. Policies

Chaque table métier porte `school_id` et une policy :

```sql
USING      ("schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
            OR current_setting('app.is_super_admin', true) = 'on')
WITH CHECK (même expression)
```

`NULLIF(..., '')` transforme l'absence de contexte en `NULL` : la comparaison est alors
fausse et la requête ne retourne **rien**. Le comportement par défaut est le refus,
pas l'ouverture.

`ENABLE` **et** `FORCE ROW LEVEL SECURITY` sont appliqués : sans `FORCE`, le propriétaire
des tables contournerait silencieusement toutes les policies.

### 4. Contrôle unique côté application

`TenancyService.run(context, work)` ouvre une transaction, pose les trois variables,
puis exécute le travail. **Aucune requête métier ne doit être écrite hors de ce service.**
Le contexte vient exclusivement du jeton de session (profil actif), jamais d'un paramètre
d'URL ou de corps de requête.

### 5. Super-admin

L'accès transversal n'est possible que si `app.is_super_admin = 'on'`, ce qui n'est posé
que par un service dédié qui écrit **obligatoirement** une ligne `AuditLog` dans la même
transaction. Aucun jeton utilisateur normal ne peut activer ce drapeau.

## Décision complémentaire : la table `User` n'a pas de RLS

**Constat :** la connexion (recherche par e-mail) et la résolution des profils ont lieu
**avant** qu'un contexte d'école existe. Appliquer une policy sur `User` rendrait le
login impossible sans un rôle `BYPASSRLS` dédié, c'est-à-dire sans recréer une porte
dérobée.

**Décision :** `User` reste sans RLS, avec des contrôles compensatoires :

1. `User` n'est lu que par trois méthodes nommées (`findForLogin`, `findWithProfiles`,
   `findForSession`) — aucune autre requête n'est autorisée sur cette table.
2. Aucun endpoint ne retourne un utilisateur à partir d'un identifiant fourni par le
   client ; tout passe par la session.
3. `passwordHash` et `mfaSecret` ne sortent jamais de la couche service (pas de `select *`
   vers le contrôleur, DTO de sortie explicite).
4. Trois tests dédiés vérifient ces règles (voir `docs/plan-lot1.md`).

**Risque résiduel assumé et daté :** une erreur dans l'une de ces trois méthodes
exposerait une identité hors école. Ce compromis est revu au Lot 7 (durcissement) avec
un rôle de connexion séparé pour l'authentification.

## Conséquences

- Les tests d'isolation doivent se connecter **avec `orya_app`**, pas avec `orya_owner`,
  sinon ils ne testent rien.
- Toute nouvelle table métier doit recevoir `schoolId` + policy + `FORCE`, dans la même
  migration. Cette règle est vérifiée par la revue de migration.
- Les sauvegardes et exports s'exécutent avec `orya_owner` et doivent être journalisés.

---

## Mise à jour du 29 octobre 2026 — policy `audit_log_self`

L'implémentation du module d'authentification a révélé un cas non couvert par la
policy initiale : les événements de **session** (connexion, défi MFA, révocation
d'appareil) ne sont rattachés à aucune école au moment où ils sont écrits.

Une seconde policy additive a donc été ajoutée sur `AuditLog` :

```sql
CREATE POLICY audit_log_self ON "AuditLog"
  FOR ALL
  USING      ("schoolId" IS NULL
              AND "actorId" = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (même expression);
```

Conséquences, vérifiées par les tests :

- un utilisateur ne peut lire que **ses propres** événements sans école ;
- une école ne voit toujours que ses événements (`audit_log_isolation`) ;
- le super-admin voit tout (drapeau `app.is_super_admin`) ;
- 15 événements de session et 5 événements d'école ont été observés en base après
  la campagne de tests.

Les policies permissives se combinent en OU : l'ajout ne réduit aucun droit existant.
