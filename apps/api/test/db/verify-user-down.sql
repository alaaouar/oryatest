-- P0-3 : verifie que le retour arriere restaure l'etat precedent.
\set ON_ERROR_STOP 1
DO $$
BEGIN
  IF NOT has_column_privilege('orya_app', '"User"', 'passwordHash', 'SELECT')
     OR NOT has_column_privilege('orya_app', '"User"', 'mfaSecret', 'SELECT')
     OR to_regprocedure('public.orya_auth_credentials(text)') IS NOT NULL
     OR to_regprocedure('public.orya_auth_mfa_state(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'D1 KO - retour arriere incomplet';
  END IF;
  RAISE NOTICE 'D1 OK - retour arriere : SELECT de orya_app restaure, fonctions supprimees';
END
$$;
