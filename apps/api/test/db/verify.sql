-- =============================================================================
-- ORYA — vérification exécutable du Lot 1 (RLS et intégrité)
--
-- À exécuter sur une base FRAÎCHE, après la migration Prisma et 010_rls.sql,
-- SANS le seed (les assertions portent sur un jeu de données minimal).
--
--   psql -v ON_ERROR_STOP=1 -f verify.sql
--
-- Les identifiants de test utilisent le préfixe f1… à f5… pour ne jamais
-- entrer en collision avec les données du seed (préfixes 0a… à 01…).
--
-- Chaque test affiche « OK » ; un échec interrompt l'exécution.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Données de test
--   École A : 2 élèves, 3 responsables (2 liés au premier élève)
--   École B : 1 élève, aucun responsable
-- ---------------------------------------------------------------------------

INSERT INTO "School" (id, name, city, code, status, "createdAt", "updatedAt") VALUES
  ('f1000000-0000-4000-8000-000000000001', 'École A', 'Casablanca', 'FIXA01', 'active', now(), now()),
  ('f1000000-0000-4000-8000-000000000002', 'École B', 'Rabat',      'FIXB01', 'active', now(), now());

INSERT INTO "Student" (id, "schoolId", "studentCode", "displayName", "createdAt", "updatedAt") VALUES
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'A-001', 'Élève A1', now(), now()),
  ('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'A-002', 'Élève A2', now(), now()),
  ('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000002', 'B-001', 'Élève B1', now(), now());

INSERT INTO "Guardian" (id, "schoolId", "fullName", "createdAt", "updatedAt") VALUES
  ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'Responsable A1', now(), now()),
  ('f3000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'Responsable A2', now(), now()),
  ('f3000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'Responsable A3', now(), now());

INSERT INTO "StudentGuardian" (id, "schoolId", "studentId", "guardianId", relationship, "isPrimary", "createdAt") VALUES
  ('f4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'père', true,  now()),
  ('f4000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002', 'mère', false, now());

INSERT INTO "AuditLog" (id, "schoolId", action, entity, "entityId", severity, "createdAt") VALUES
  ('f5000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'test.create', 'Student', 'f2000000-0000-4000-8000-000000000001', 'info', now());

-- ===========================================================================
-- T6 — maximum deux responsables par élève (trigger)
-- ===========================================================================
DO $$
BEGIN
  BEGIN
    INSERT INTO "StudentGuardian" (id, "schoolId", "studentId", "guardianId", "createdAt")
    VALUES ('f4000000-0000-4000-8000-000000000003',
            'f1000000-0000-4000-8000-000000000001',
            'f2000000-0000-4000-8000-000000000001',
            'f3000000-0000-4000-8000-000000000003',
            now());
    RAISE EXCEPTION 'T6 FAIL — un troisième responsable a été accepté';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'T6 OK — troisième responsable refusé (ORYA_MAX_GUARDIANS)';
  END;
END
$$;

-- ===========================================================================
-- T7 — journal d'audit inaltérable (trigger)
-- ===========================================================================
DO $$
BEGIN
  BEGIN
    UPDATE "AuditLog" SET action = 'falsifie' WHERE action = 'test.create';
    RAISE EXCEPTION 'T7 FAIL — une ligne d''audit a pu être modifiée';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T7 OK — modification du journal d''audit refusée (ORYA_AUDIT_IMMUTABLE)';
  END;
END
$$;

-- ===========================================================================
-- À partir d'ici : rôle applicatif soumis au RLS
-- ===========================================================================
SET ROLE orya_app;

-- ---------------------------------------------------------------------------
-- T2 — sans contexte d'école : aucune ligne visible (refus par défaut)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  eleves integer;
BEGIN
  SELECT count(*) INTO eleves FROM "Student";
  IF eleves <> 0 THEN
    RAISE EXCEPTION 'T2 FAIL — % élèves visibles sans contexte', eleves;
  END IF;
  RAISE NOTICE 'T2 OK — 0 ligne visible sans contexte d''école';
END
$$;

-- ---------------------------------------------------------------------------
-- T1 — contexte école A : uniquement les élèves de A
-- ---------------------------------------------------------------------------
SELECT set_config('app.school_id', 'f1000000-0000-4000-8000-000000000001', false);

DO $$
DECLARE
  eleves integer;
  liens  integer;
BEGIN
  SELECT count(*) INTO eleves FROM "Student";
  IF eleves <> 2 THEN
    RAISE EXCEPTION 'T1 FAIL — % élèves visibles pour A au lieu de 2', eleves;
  END IF;

  SELECT count(*) INTO liens FROM "StudentGuardian";
  IF liens <> 2 THEN
    RAISE EXCEPTION 'T1 FAIL — % liens visibles pour A au lieu de 2', liens;
  END IF;

  RAISE NOTICE 'T1 OK — école A ne voit que ses 2 élèves et ses 2 liens';
END
$$;

-- ---------------------------------------------------------------------------
-- T5 — contexte école B : uniquement l'élève de B, aucun lien de A
-- ---------------------------------------------------------------------------
SELECT set_config('app.school_id', 'f1000000-0000-4000-8000-000000000002', false);

DO $$
DECLARE
  eleves integer;
  liens  integer;
BEGIN
  SELECT count(*) INTO eleves FROM "Student";
  IF eleves <> 1 THEN
    RAISE EXCEPTION 'T5 FAIL — % élèves visibles pour B au lieu de 1', eleves;
  END IF;

  SELECT count(*) INTO liens FROM "StudentGuardian";
  IF liens <> 0 THEN
    RAISE EXCEPTION 'T5 FAIL — B voit % liens élève/responsable de A', liens;
  END IF;

  RAISE NOTICE 'T5 OK — école B ne voit que son élève et aucun lien de A';
END
$$;

-- ---------------------------------------------------------------------------
-- T3 — écriture avec un schoolId différent du contexte : refusée
-- ---------------------------------------------------------------------------
SELECT set_config('app.school_id', 'f1000000-0000-4000-8000-000000000001', false);

DO $$
BEGIN
  BEGIN
    INSERT INTO "Student" (id, "schoolId", "studentCode", "displayName", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(),
            'f1000000-0000-4000-8000-000000000002',
            'INTRUS', 'Élève intrus', now(), now());
    RAISE EXCEPTION 'T3 FAIL — écriture inter-écoles acceptée';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T3 OK — écriture dans une autre école refusée par la policy';
  END;
END
$$;

-- ---------------------------------------------------------------------------
-- T8 — le rôle applicatif ne peut pas détruire une table
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    EXECUTE 'DROP TABLE "Student"';
    RAISE EXCEPTION 'T8 FAIL — orya_app a pu supprimer une table';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T8 OK — DROP TABLE refusé au rôle applicatif';
  END;
END
$$;

-- ---------------------------------------------------------------------------
-- T9 — le journal d'audit n'est pas modifiable par le rôle applicatif
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    EXECUTE 'UPDATE "AuditLog" SET action = ''falsifie''';
    RAISE EXCEPTION 'T9 FAIL — orya_app a pu modifier le journal';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T9 OK — orya_app ne peut pas modifier le journal d''audit';
  END;
END
$$;

-- ---------------------------------------------------------------------------
-- T10 — Lot 2.2 : isolation RLS des sessions d'appel
-- ---------------------------------------------------------------------------
RESET ROLE;

INSERT INTO "Classroom" (id, "schoolId", name, "createdAt", "updatedAt") VALUES
  ('f6000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'FIX-ATT-A', now(), now()),
  ('f6000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'FIX-ATT-B', now(), now());

INSERT INTO "AttendanceSession" (id, "schoolId", "classroomId", date, slot, status, "schoolYear", "createdAt", "updatedAt") VALUES
  ('f7000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001', '2026-10-30', 'morning', 'open', '2026-2027', now(), now()),
  ('f7000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'f6000000-0000-4000-8000-000000000002', '2026-10-30', 'afternoon', 'open', '2026-2027', now(), now());

SET ROLE orya_app;
SELECT set_config('app.user_id', 'f1000000-0000-4000-8000-000000000001', true);
SELECT set_config('app.school_id', 'f1000000-0000-4000-8000-000000000001', true);
SELECT set_config('app.is_super_admin', 'off', true);

DO $$
DECLARE
  visible integer;
BEGIN
  SELECT count(*) INTO visible FROM "AttendanceSession";
  IF visible <> 1 THEN
    RAISE EXCEPTION 'T10 FAIL — école A devrait voir 1 session, en voit %', visible;
  END IF;
  RAISE NOTICE 'T10 OK — école A ne voit que sa session d''appel';
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "AttendanceSession" (id, "schoolId", "classroomId", date, slot, "schoolYear", "createdAt", "updatedAt")
    VALUES (
      'f7000000-0000-4000-8000-000000000099',
      'f1000000-0000-4000-8000-000000000002',
      'f6000000-0000-4000-8000-000000000002',
      '2026-10-31',
      'morning',
      '2026-2027',
      now(),
      now()
    );
    RAISE EXCEPTION 'T10b FAIL — écriture inter-école autorisée';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation OR OTHERS THEN
      IF SQLERRM LIKE 'T10b FAIL%' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'T10b OK — écriture d''une session dans une autre école refusée';
  END;
END
$$;

RESET ROLE;

-- ===========================================================================
-- Lot 9 — RLS renforcée : abonnement, factures, instantanés, plans
-- (l'école LIT, seul le super-admin ÉCRIT)
-- ===========================================================================
INSERT INTO "Plan" (id, code, name, "updatedAt") VALUES
  ('f9000000-0000-4000-8000-000000000001', 'test-rls-plan', 'Plan RLS', now());
INSERT INTO "Subscription" (id, "schoolId", status, "updatedAt") VALUES
  ('f9100000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'trial', now()),
  ('f9100000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'trial', now());
INSERT INTO "Invoice" (id, "schoolId", "periodStart", "periodEnd", lines, "updatedAt") VALUES
  ('f9200000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', '2026-10-01', '2026-10-31', '[]', now());
INSERT INTO "UsageSnapshot" (id, "schoolId", metrics) VALUES
  ('f9300000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', '{}');

SET ROLE orya_app;
SELECT set_config('app.user_id', 'f1000000-0000-4000-8000-000000000001', false);
SELECT set_config('app.school_id', 'f1000000-0000-4000-8000-000000000001', false);
SELECT set_config('app.is_super_admin', 'off', false);

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM "Subscription";
  IF n <> 1 THEN RAISE EXCEPTION 'L9-1 FAIL — école A voit % abonnements au lieu de 1', n; END IF;
  RAISE NOTICE 'L9-1 OK — école A lit uniquement son abonnement';

  UPDATE "Subscription" SET status = 'active' WHERE "schoolId" = 'f1000000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'L9-2 FAIL — école A a modifié son abonnement'; END IF;
  RAISE NOTICE 'L9-2 OK — école A ne peut pas modifier son abonnement';

  SELECT count(*) INTO n FROM "Invoice";
  IF n <> 0 THEN RAISE EXCEPTION 'L9-3 FAIL — école A voit % factures de B', n; END IF;
  RAISE NOTICE 'L9-3 OK — factures de B invisibles pour A';

  SELECT count(*) INTO n FROM "UsageSnapshot";
  IF n <> 1 THEN RAISE EXCEPTION 'L9-4 FAIL — % instantanés visibles', n; END IF;
  RAISE NOTICE 'L9-4 OK — école A lit son instantané d''usage';

  SELECT count(*) INTO n FROM "Plan" WHERE code = 'test-rls-plan';
  IF n <> 1 THEN RAISE EXCEPTION 'L9-5 FAIL — catalogue de plans illisible'; END IF;
  UPDATE "Plan" SET "maxStudents" = 1 WHERE code = 'test-rls-plan';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'L9-5 FAIL — école A a modifié un plan'; END IF;
  RAISE NOTICE 'L9-5 OK — plans lisibles, non modifiables par une école';
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO "Invoice" (id, "schoolId", "periodStart", "periodEnd", lines, "updatedAt")
    VALUES ('f9200000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31', '[]', now());
    RAISE EXCEPTION 'L9-6 FAIL — une école a créé sa propre facture';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'L9-6 FAIL%' THEN RAISE; END IF;
      RAISE NOTICE 'L9-6 OK — création de facture refusée à l''école';
  END;
  BEGIN
    INSERT INTO "Subscription" (id, "schoolId", status, "updatedAt")
    VALUES ('f9100000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000001', 'active', now());
    RAISE EXCEPTION 'L9-7 FAIL — une école a créé un abonnement';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'L9-7 FAIL%' THEN RAISE; END IF;
      RAISE NOTICE 'L9-7 OK — création d''abonnement refusée à l''école';
  END;
END
$$;

SELECT set_config('app.school_id', '', false);
SELECT set_config('app.is_super_admin', 'on', false);

DO $$
DECLARE
  n integer;
BEGIN
  UPDATE "Subscription" SET status = 'active' WHERE id = 'f9100000-0000-4000-8000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'L9-8 FAIL — le super-admin ne peut pas modifier l''abonnement'; END IF;
  SELECT count(*) INTO n FROM "Invoice";
  IF n <> 1 THEN RAISE EXCEPTION 'L9-8 FAIL — le super-admin voit % factures', n; END IF;
  RAISE NOTICE 'L9-8 OK — le super-admin (contexte explicite) écrit et lit inter-écoles';
END
$$;

SELECT set_config('app.is_super_admin', 'off', false);
RESET ROLE;

\echo '=== TOUS LES TESTS SONT PASSES ==='
