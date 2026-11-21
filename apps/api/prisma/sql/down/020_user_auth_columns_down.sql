-- =============================================================================
-- ORYA - retour arriere de la section 7 de 010_rls.sql (P0-3, colonnes "User")
-- A executer en administrateur, AVEC le retour du code API qui lisait "User"
-- directement (sinon la connexion echoue : fonctions absentes).
-- Pour un retour definitif, retirer aussi la section 7 de 010_rls.sql.
-- =============================================================================
DROP FUNCTION IF EXISTS public.orya_auth_credentials(text);
-- @@
DROP FUNCTION IF EXISTS public.orya_auth_mfa_state(uuid);
-- @@
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orya_auth') THEN
    EXECUTE 'REVOKE ALL ON "User" FROM orya_auth';
  END IF;
END
$$;
-- @@
GRANT SELECT ON "User" TO orya_app;
