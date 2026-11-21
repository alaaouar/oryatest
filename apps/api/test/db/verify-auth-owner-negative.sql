-- A1 (P0-3) : le controle bloquant de 010_rls.sql detecte un mauvais proprietaire.
-- Tout se passe dans une transaction annulee : l'etat de la base est inchange.
\set ON_ERROR_STOP 1
BEGIN;
ALTER FUNCTION public.orya_auth_mfa_state(uuid) OWNER TO CURRENT_USER;
DO $$
BEGIN
  BEGIN
    IF (SELECT count(*) FROM pg_catalog.pg_proc p
          JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname IN ('orya_auth_credentials', 'orya_auth_mfa_state')
           AND pg_catalog.pg_get_userbyid(p.proowner) = 'orya_auth') <> 2 THEN
      RAISE EXCEPTION 'P0-3 BLOQUANT : orya_auth doit posseder orya_auth_credentials et orya_auth_mfa_state.';
    END IF;
    RAISE EXCEPTION 'A1 KO - mauvais proprietaire non detecte' USING ERRCODE = 'OR001';
  EXCEPTION
    WHEN sqlstate 'OR001' THEN RAISE;
    WHEN raise_exception THEN RAISE NOTICE 'A1 OK - mauvais proprietaire detecte, deploiement refuse (%)', SQLERRM;
  END;
END
$$;
ROLLBACK;
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE proname IN ('orya_auth_credentials', 'orya_auth_mfa_state')
        AND pg_catalog.pg_get_userbyid(proowner) = 'orya_auth') <> 2 THEN
    RAISE EXCEPTION 'A1 KO - etat non restaure';
  END IF;
  RAISE NOTICE 'A1 OK - apres annulation, orya_auth possede toujours les deux fonctions';
END
$$;
