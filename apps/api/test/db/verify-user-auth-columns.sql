-- P0-3 : tests d'acceptation des privileges sur "User" (execute en superutilisateur,
-- les essais "orya_app" utilisent SET ROLE). Donnees fictives, supprimees en fin de fichier.
\set ON_ERROR_STOP 1
INSERT INTO "User" (id, email, "passwordHash", status, "failedLoginCount", "updatedAt")
VALUES ('f9000000-0000-4000-8000-000000000001', 'u-priv@test.orya.test', '$argon2id$fictif-test', 'active', 2, now())
ON CONFLICT (email) DO NOTHING;

DO $$
BEGIN
  IF has_column_privilege('orya_app', '"User"', 'passwordHash', 'SELECT')
     OR has_column_privilege('orya_app', '"User"', 'mfaSecret', 'SELECT')
     OR has_column_privilege('orya_app', '"User"', 'mfaLastStep', 'SELECT')
     OR has_column_privilege('orya_app', '"User"', 'failedLoginCount', 'SELECT')
     OR has_column_privilege('orya_app', '"User"', 'lockedUntil', 'SELECT') THEN
    RAISE EXCEPTION 'U1 KO - orya_app lit encore une colonne sensible';
  END IF;
  IF NOT has_column_privilege('orya_app', '"User"', 'email', 'SELECT')
     OR NOT has_column_privilege('orya_app', '"User"', 'passwordHash', 'UPDATE') THEN
    RAISE EXCEPTION 'U1 KO - privileges utiles retires a tort';
  END IF;
  RAISE NOTICE 'U1 OK - has_column_privilege(orya_app, User, passwordHash/mfaSecret/mfaLastStep/failedLoginCount/lockedUntil, SELECT) = false';
END
$$;

SET ROLE orya_app;
DO $$
BEGIN
  PERFORM "passwordHash" FROM "User" LIMIT 1;
  RAISE EXCEPTION 'U2 KO - SELECT passwordHash accepte';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'U2 OK - SELECT direct de passwordHash refuse a orya_app';
END
$$;
DO $$
BEGIN
  PERFORM "mfaSecret" FROM "User" LIMIT 1;
  RAISE EXCEPTION 'U3 KO - SELECT mfaSecret accepte';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'U3 OK - SELECT direct de mfaSecret refuse a orya_app';
END
$$;
DO $$
BEGIN
  PERFORM * FROM "User" LIMIT 1;
  RAISE EXCEPTION 'U4 KO - SELECT * accepte';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'U4 OK - SELECT * sur User refuse a orya_app';
END
$$;
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "User" WHERE email = 'u-priv@test.orya.test';
  IF n <> 1 THEN RAISE EXCEPTION 'U5 KO - lecture des colonnes non sensibles impossible'; END IF;
  UPDATE "User" SET "failedLoginCount" = 3, "lockedUntil" = NULL WHERE id = 'f9000000-0000-4000-8000-000000000001';
  RAISE NOTICE 'U5 OK - orya_app lit id/email et ecrit encore les compteurs (valeur absolue)';
END
$$;
DO $$
DECLARE r record; n integer;
BEGIN
  SELECT count(*) INTO n FROM orya_auth_credentials('absent@nulle-part.test');
  SELECT * INTO r FROM orya_auth_credentials('absent@nulle-part.test');
  IF n <> 1 OR r.found OR r.user_id IS NOT NULL OR r.password_hash IS NOT NULL THEN
    RAISE EXCEPTION 'U6 KO - reponse differente pour un e-mail inconnu';
  END IF;
  SELECT count(*) INTO n FROM orya_auth_credentials('  U-Priv@Test.Orya.Test ');
  SELECT * INTO r FROM orya_auth_credentials('  U-Priv@Test.Orya.Test ');
  IF n <> 1 OR NOT r.found OR r.password_hash IS NULL OR r.failed_login_count <> 3 THEN
    RAISE EXCEPTION 'U6 KO - compte existant mal lu';
  END IF;
  RAISE NOTICE 'U6 OK - orya_auth_credentials : une ligne de meme forme, e-mail connu ou non';
  SELECT count(*) INTO n FROM orya_auth_credentials('%');
  SELECT * INTO r FROM orya_auth_credentials('%');
  IF n <> 1 OR r.found THEN RAISE EXCEPTION 'U7 KO - motif accepte'; END IF;
  SELECT count(*) INTO n FROM orya_auth_credentials(NULL);
  IF n <> 1 THEN RAISE EXCEPTION 'U7 KO - NULL'; END IF;
  RAISE NOTICE 'U7 OK - aucun motif ni liste (%%, NULL -> found = false)';
  SELECT * INTO r FROM orya_auth_mfa_state('f9000000-0000-4000-8000-0000000000ff');
  IF r.found OR r.mfa_secret IS NOT NULL THEN RAISE EXCEPTION 'U8 KO'; END IF;
  SELECT * INTO r FROM orya_auth_mfa_state('f9000000-0000-4000-8000-000000000001');
  IF NOT r.found OR r.status <> 'active' THEN RAISE EXCEPTION 'U8 KO - compte existant'; END IF;
  RAISE NOTICE 'U8 OK - orya_auth_mfa_state : une ligne, par identifiant uniquement';
END
$$;
RESET ROLE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.proname IN ('orya_auth_credentials', 'orya_auth_mfa_state')
      AND (NOT p.prosecdef
           OR p.proacl IS NULL
           OR pg_get_userbyid(p.proowner) <> 'orya_auth'
           OR NOT ('search_path=pg_catalog, pg_temp' = ANY (p.proconfig))
           OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
           OR NOT has_function_privilege('orya_app', p.oid, 'EXECUTE'))
  ) OR (SELECT count(*) FROM pg_proc WHERE proname IN ('orya_auth_credentials', 'orya_auth_mfa_state')) <> 2 THEN
    RAISE EXCEPTION 'U9 KO - fonctions mal configurees';
  END IF;
  IF (SELECT rolcanlogin OR rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'orya_auth') THEN
    RAISE EXCEPTION 'U9 KO - orya_auth trop puissant';
  END IF;
  RAISE NOTICE 'U9 OK - SECURITY DEFINER, search_path fixe, proprietaire orya_auth (NOLOGIN), EXECUTE a orya_app seul, rien a PUBLIC';
END
$$;

DELETE FROM "User" WHERE id = 'f9000000-0000-4000-8000-000000000001';
SELECT 'P0-3 : 9 controles OK' AS resultat;
