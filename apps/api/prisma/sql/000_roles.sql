-- =============================================================================
-- ORYA — Rôles PostgreSQL (à exécuter UNE SEULE FOIS, en superutilisateur)
--
--   docker exec -i orya-postgres psql -U postgres -d orya -v ON_ERROR_STOP=1 < 000_roles.sql
--
-- Aucun mot de passe dans ce fichier : ils sont définis hors du dépôt, avec
--   ALTER ROLE orya_owner PASSWORD '...';
--   ALTER ROLE orya_app   PASSWORD '...';
--
-- Deux rôles, deux usages :
--   orya_owner : propriétaire des tables, migrations, seed, policies (BYPASSRLS)
--   orya_app   : rôle de l'API à l'exécution, soumis au RLS (NOBYPASSRLS)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orya_owner') THEN
    CREATE ROLE orya_owner LOGIN PASSWORD NULL BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orya_app') THEN
    CREATE ROLE orya_app LOGIN PASSWORD NULL NOBYPASSRLS;
  END IF;

  -- Un rôle ne doit jamais être superutilisateur ni créer des rôles.
  ALTER ROLE orya_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  ALTER ROLE orya_app   NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

  -- Le runtime n'a pas le droit de contourner le RLS, même par erreur future.
  ALTER ROLE orya_app NOBYPASSRLS;
END
$$;

-- @@

-- Accès à la base et au schéma
-- Base courante (orya, orya_v2, base jetable...) : jamais de nom code en dur.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO orya_owner, orya_app', current_database());
END
$$;

-- @@
GRANT USAGE ON SCHEMA public TO orya_app;

-- @@

-- Le propriétaire doit pouvoir créer les objets des migrations
GRANT CREATE, USAGE ON SCHEMA public TO orya_owner;

-- @@

-- Sécurité par défaut : on retire les droits publics hérités
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Les privilèges sur les tables sont accordés par 010_rls.sql,
-- après la création des tables par Prisma Migrate.

-- @@

-- P0-3 : proprietaire restreint des fonctions d'authentification (SECURITY DEFINER).
-- NOLOGIN : personne ne s'y connecte ; il ne recoit que SELECT sur "User" (010_rls.sql).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orya_auth') THEN
    CREATE ROLE orya_auth NOLOGIN NOBYPASSRLS;
  END IF;
  ALTER ROLE orya_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  -- orya_owner peut rejouer 010_rls.sql (CREATE OR REPLACE des fonctions detenues par orya_auth).
  GRANT orya_auth TO orya_owner;
  -- ALTER FUNCTION ... OWNER TO orya_auth exige CREATE sur le schema pour le nouveau proprietaire
  -- (sinon seul un superutilisateur peut le faire). orya_auth reste NOLOGIN.
  GRANT USAGE, CREATE ON SCHEMA public TO orya_auth;
END
$$;
