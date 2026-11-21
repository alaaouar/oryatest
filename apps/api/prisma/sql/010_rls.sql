-- =============================================================================
-- ORYA — Row Level Security, intégrité et privilèges (Lot 1)
--
-- Exécution : npm run db:rls   (après la migration Prisma, avec orya_owner)
-- Idempotent : peut être relancé autant de fois que nécessaire.
--
-- Les instructions sont séparées par une ligne « -- @@ » : apply-sql.ts exécute
-- chaque bloc séparément, dans une seule transaction.
--
-- Contexte attendu à l'exécution (posé par TenancyService, par transaction) :
--   app.school_id       uuid de l'école, ou chaîne vide
--   app.user_id         uuid de l'utilisateur connecté
--   app.is_super_admin  'on' | 'off'
--
-- Rappel : NULLIF(current_setting(...), '') renvoie NULL quand le contexte est
-- absent, donc la comparaison est fausse et la requête ne renvoie RIEN.
-- Le comportement par défaut est le refus.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Activation du RLS (ENABLE + FORCE)
-- FORCE est indispensable : sans lui, le propriétaire des tables (orya_owner)
-- contournerait silencieusement toutes les policies.
-- ---------------------------------------------------------------------------

ALTER TABLE "School" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "School" FORCE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "UserProfile" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "UserProfile" FORCE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Device" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Device" FORCE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Invitation" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Invitation" FORCE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Student" FORCE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Guardian" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Guardian" FORCE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "StudentGuardian" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "StudentGuardian" FORCE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Consent" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Consent" FORCE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
-- @@

-- ---------------------------------------------------------------------------
-- 2. Policies d'isolation
-- Note : la table "User" n'a volontairement pas de RLS (voir ADR-002).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS school_read ON "School";
-- @@
CREATE POLICY school_read ON "School"
  FOR SELECT
  USING (
    id = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS school_write ON "School";
-- @@
CREATE POLICY school_write ON "School"
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'on')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@
DROP POLICY IF EXISTS user_profile_isolation ON "UserProfile";
-- @@
CREATE POLICY user_profile_isolation ON "UserProfile"
  FOR ALL
  USING (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS device_isolation ON "Device";
-- @@
CREATE POLICY device_isolation ON "Device"
  FOR ALL
  USING (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS invitation_isolation ON "Invitation";
-- @@
CREATE POLICY invitation_isolation ON "Invitation"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS student_isolation ON "Student";
-- @@
CREATE POLICY student_isolation ON "Student"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS guardian_isolation ON "Guardian";
-- @@
CREATE POLICY guardian_isolation ON "Guardian"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS student_guardian_isolation ON "StudentGuardian";
-- @@
CREATE POLICY student_guardian_isolation ON "StudentGuardian"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS consent_isolation ON "Consent";
-- @@
CREATE POLICY consent_isolation ON "Consent"
  FOR ALL
  USING (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS audit_log_isolation ON "AuditLog";
-- @@
CREATE POLICY audit_log_isolation ON "AuditLog"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- Les événements de session (connexion, MFA, appareil) ne sont rattachés à
-- aucune école : l'utilisateur peut lire et écrire ses propres lignes sans
-- école. Elles ne sont visibles ni par l'école ni par un autre utilisateur.
DROP POLICY IF EXISTS audit_log_self ON "AuditLog";
-- @@
CREATE POLICY audit_log_self ON "AuditLog"
  FOR ALL
  USING (
    "schoolId" IS NULL
    AND "actorId" = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    "schoolId" IS NULL
    AND "actorId" = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
-- @@

-- ---------------------------------------------------------------------------
-- Abonnements (schéma posé au Lot 1, facturation au Lot 6)
-- ---------------------------------------------------------------------------

ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS subscription_isolation ON "Subscription";
-- @@
-- Lot 9 : l'école LIT son abonnement ; seul le super-admin l'écrit.
DROP POLICY IF EXISTS subscription_read ON "Subscription";
-- @@
CREATE POLICY subscription_read ON "Subscription"
  FOR SELECT
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS subscription_write ON "Subscription";
-- @@
CREATE POLICY subscription_write ON "Subscription"
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'on')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@

-- ---------------------------------------------------------------------------
-- Recherche d'une école par son code public (activation d'un parent).
-- Seule la ligne dont le code correspond exactement est lisible.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS school_code_lookup ON "School";
-- @@
CREATE POLICY school_code_lookup ON "School"
  FOR SELECT
  USING (code = NULLIF(current_setting('app.school_code', true), ''));
-- @@

-- ---------------------------------------------------------------------------

-- 3.1 Maximum deux responsables par élève (CDC §3.2)
CREATE OR REPLACE FUNCTION orya_enforce_max_guardians()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  responsables integer;
BEGIN
  SELECT count(*) INTO responsables
  FROM "StudentGuardian"
  WHERE "studentId" = NEW."studentId";

  IF responsables >= 2 THEN
    RAISE EXCEPTION 'ORYA_MAX_GUARDIANS: un eleve ne peut avoir que deux responsables'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
-- @@
DROP TRIGGER IF EXISTS student_guardian_max ON "StudentGuardian";
-- @@
CREATE TRIGGER student_guardian_max
  BEFORE INSERT ON "StudentGuardian"
  FOR EACH ROW
  EXECUTE FUNCTION orya_enforce_max_guardians();
-- @@

-- 3.2 Journal d'audit inaltérable (CDC §8 S-5)
CREATE OR REPLACE FUNCTION orya_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ORYA_AUDIT_IMMUTABLE: le journal d''audit ne peut etre modifie ni supprime'
    USING ERRCODE = '42501';
END;
$$;
-- @@
DROP TRIGGER IF EXISTS audit_log_no_update ON "AuditLog";
-- @@
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION orya_audit_immutable();
-- @@

-- ---------------------------------------------------------------------------
-- 4. Privilèges du rôle applicatif
-- À exécuter après la création des tables. Le runtime ne reçoit que le strict
-- nécessaire, et jamais UPDATE/DELETE sur le journal d'audit.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orya_app;
-- @@
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orya_app;
-- @@
REVOKE UPDATE, DELETE, TRUNCATE ON "AuditLog" FROM orya_app;
-- @@
DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON "_prisma_migrations" FROM orya_app';
  END IF;
END
$$;
-- @@
ALTER DEFAULT PRIVILEGES FOR ROLE orya_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orya_app;
-- @@
ALTER DEFAULT PRIVILEGES FOR ROLE orya_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO orya_app;
-- @@

-- ---------------------------------------------------------------------------
-- 5. Lot 2.1 — classes, inscriptions, imports
-- ---------------------------------------------------------------------------

ALTER TABLE "Classroom" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Classroom" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS classroom_isolation ON "Classroom";
-- @@
CREATE POLICY classroom_isolation ON "Classroom"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "Enrollment" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Enrollment" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS enrollment_isolation ON "Enrollment";
-- @@
CREATE POLICY enrollment_isolation ON "Enrollment"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "ImportJob" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "ImportJob" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS import_job_isolation ON "ImportJob";
-- @@
CREATE POLICY import_job_isolation ON "ImportJob"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "ImportRowError" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "ImportRowError" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS import_row_error_isolation ON "ImportRowError";
-- @@
CREATE POLICY import_row_error_isolation ON "ImportRowError"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@

-- ---------------------------------------------------------------------------
-- 6. Lot 2.2 — affectations, sessions d'appel, lignes de présence
-- ---------------------------------------------------------------------------

ALTER TABLE "TeacherClassroomAssignment" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "TeacherClassroomAssignment" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS teacher_assignment_isolation ON "TeacherClassroomAssignment";
-- @@
CREATE POLICY teacher_assignment_isolation ON "TeacherClassroomAssignment"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "AttendanceSession" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "AttendanceSession" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS attendance_session_isolation ON "AttendanceSession";
-- @@
CREATE POLICY attendance_session_isolation ON "AttendanceSession"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "AttendanceRow" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "AttendanceRow" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS attendance_row_isolation ON "AttendanceRow";
-- @@
CREATE POLICY attendance_row_isolation ON "AttendanceRow"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@

-- Lot 4 : espace parents
ALTER TABLE "StoredFile" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "StoredFile" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS stored_file_isolation ON "StoredFile";
-- @@
CREATE POLICY stored_file_isolation ON "StoredFile"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "AbsenceJustification" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "AbsenceJustification" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS absence_justification_isolation ON "AbsenceJustification";
-- @@
CREATE POLICY absence_justification_isolation ON "AbsenceJustification"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Notification" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS notification_isolation ON "Notification";
-- @@
CREATE POLICY notification_isolation ON "Notification"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- t92 (CDC M2) : calendrier scolaire, isolation par ecole.
ALTER TABLE "SchoolCalendar" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "SchoolCalendar" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS school_calendar_isolation ON "SchoolCalendar";
-- @@
CREATE POLICY school_calendar_isolation ON "SchoolCalendar"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- t92 (CDC M2) : calendrier scolaire, isolation par ecole.
ALTER TABLE "SchoolHoliday" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "SchoolHoliday" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS school_holiday_isolation ON "SchoolHoliday";
-- @@
CREATE POLICY school_holiday_isolation ON "SchoolHoliday"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- t92 (CDC M7) : resultats, isolation par ecole.
ALTER TABLE "Assessment" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Assessment" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS assessment_isolation ON "Assessment";
-- @@
CREATE POLICY assessment_isolation ON "Assessment"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- t92 (CDC M7) : resultats, isolation par ecole.
ALTER TABLE "AssessmentResult" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "AssessmentResult" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS assessment_result_isolation ON "AssessmentResult";
-- @@
CREATE POLICY assessment_result_isolation ON "AssessmentResult"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- t92 (CDC 3.5 / 5) : circuits de transport, isolation par ecole.
ALTER TABLE "BusCircuit" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "BusCircuit" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS bus_circuit_isolation ON "BusCircuit";
-- @@
CREATE POLICY bus_circuit_isolation ON "BusCircuit"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- t92 (CDC 3.5 / 5) : circuits de transport, isolation par ecole.
ALTER TABLE "BusStop" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "BusStop" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS bus_stop_isolation ON "BusStop";
-- @@
CREATE POLICY bus_stop_isolation ON "BusStop"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- t92 (CDC 3.5 / 5) : circuits de transport, isolation par ecole.
ALTER TABLE "BusCircuitStudent" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "BusCircuitStudent" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS bus_circuit_student_isolation ON "BusCircuitStudent";
-- @@
CREATE POLICY bus_circuit_student_isolation ON "BusCircuitStudent"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "ParentAction" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "ParentAction" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS parent_action_isolation ON "ParentAction";
-- @@
CREATE POLICY parent_action_isolation ON "ParentAction"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@

-- Lot 5 : communication
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Message" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS message_isolation ON "Message";
-- @@
CREATE POLICY message_isolation ON "Message"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "MessageRecipient" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "MessageRecipient" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS message_recipient_isolation ON "MessageRecipient";
-- @@
CREATE POLICY message_recipient_isolation ON "MessageRecipient"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "MessageReply" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "MessageReply" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS message_reply_isolation ON "MessageReply";
-- @@
CREATE POLICY message_reply_isolation ON "MessageReply"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@

-- Lot 6 : agenda et devoirs
ALTER TABLE "AgendaItem" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "AgendaItem" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS agenda_item_isolation ON "AgendaItem";
-- @@
CREATE POLICY agenda_item_isolation ON "AgendaItem"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "AgendaAttachment" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "AgendaAttachment" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS agenda_attachment_isolation ON "AgendaAttachment";
-- @@
CREATE POLICY agenda_attachment_isolation ON "AgendaAttachment"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "MassarExport" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "MassarExport" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS massar_export_isolation ON "MassarExport";
-- @@
CREATE POLICY massar_export_isolation ON "MassarExport"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- Lot 9 : plans (catalogue plateforme, lisible par tous, écrit par le super-admin),
-- factures et instantanés d'usage (lus par l'école, écrits par le super-admin).
ALTER TABLE "Plan" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Plan" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS plan_read ON "Plan";
-- @@
CREATE POLICY plan_read ON "Plan" FOR SELECT USING (true);
-- @@
DROP POLICY IF EXISTS plan_write ON "Plan";
-- @@
CREATE POLICY plan_write ON "Plan"
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'on')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS invoice_read ON "Invoice";
-- @@
CREATE POLICY invoice_read ON "Invoice"
  FOR SELECT
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS invoice_write ON "Invoice";
-- @@
CREATE POLICY invoice_write ON "Invoice"
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'on')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@
ALTER TABLE "UsageSnapshot" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "UsageSnapshot" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS usage_snapshot_read ON "UsageSnapshot";
-- @@
CREATE POLICY usage_snapshot_read ON "UsageSnapshot"
  FOR SELECT
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS usage_snapshot_write ON "UsageSnapshot";
-- @@
CREATE POLICY usage_snapshot_write ON "UsageSnapshot"
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'on')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@

-- ---------------------------------------------------------------------------

-- @@
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 8. Bloc 2 : ConsentText, ParentalConsent, AccountDeletionRequest, DeletionRegister
-- ---------------------------------------------------------------------------
ALTER TABLE "ConsentText" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "ConsentText" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS consent_text_read ON "ConsentText";
-- @@
-- Lecture : textes VALIDES pour tout contexte (route authentifiee, runIdentity) ;
-- brouillons reserves au super-admin (plus de lecture publique des brouillons).
CREATE POLICY consent_text_read ON "ConsentText"
  FOR SELECT
  USING (status = 'validated' OR current_setting('app.is_super_admin', true) = 'on');
-- @@
DROP POLICY IF EXISTS consent_text_write ON "ConsentText";
-- @@
CREATE POLICY consent_text_write ON "ConsentText"
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'on')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@
-- Corps, version, locale et empreinte immuables. Seuls status (draft->validated)
-- et effectiveAt / retiredAt peuvent changer.
CREATE OR REPLACE FUNCTION orya_consent_text_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ORYA_CONSENT_TEXT_IMMUTABLE: un texte de consentement ne peut etre supprime'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.purpose IS DISTINCT FROM NEW.purpose
     OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.locale IS DISTINCT FROM NEW.locale
     OR OLD.body IS DISTINCT FROM NEW.body
     OR OLD."bodySha256" IS DISTINCT FROM NEW."bodySha256"
     OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
     OR (OLD.status = 'validated' AND (
          NEW.status IS DISTINCT FROM OLD.status
          OR NEW."legalDocumentRef" IS DISTINCT FROM OLD."legalDocumentRef"
          OR NEW."legalValidatedAt" IS DISTINCT FROM OLD."legalValidatedAt"
          OR NEW."validatedById" IS DISTINCT FROM OLD."validatedById"
          OR NEW."effectiveAt" IS DISTINCT FROM OLD."effectiveAt")) THEN
    RAISE EXCEPTION 'ORYA_CONSENT_TEXT_IMMUTABLE: le contenu d''un texte de consentement est figé'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
-- @@
DROP TRIGGER IF EXISTS consent_text_no_update ON "ConsentText";
-- @@
CREATE TRIGGER consent_text_no_update
  BEFORE UPDATE OR DELETE ON "ConsentText"
  FOR EACH ROW
  EXECUTE FUNCTION orya_consent_text_immutable();
-- @@
ALTER TABLE "ParentalConsent" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "ParentalConsent" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS parental_consent_isolation ON "ParentalConsent";
-- @@
CREATE POLICY parental_consent_isolation ON "ParentalConsent"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "AccountDeletionRequest" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "AccountDeletionRequest" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS account_deletion_isolation ON "AccountDeletionRequest";
-- @@
CREATE POLICY account_deletion_isolation ON "AccountDeletionRequest"
  FOR ALL
  USING (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR "requestedById" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR "requestedById" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "DeletionRegister" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "DeletionRegister" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS deletion_register_admin ON "DeletionRegister";
-- @@
CREATE POLICY deletion_register_admin ON "DeletionRegister"
  FOR SELECT
  USING (current_setting('app.is_super_admin', true) = 'on');
-- @@
-- Insertions du registre : uniquement via la fonction d'anonymisation (SECURITY DEFINER).
DROP POLICY IF EXISTS deletion_register_insert ON "DeletionRegister";
-- @@
CREATE POLICY deletion_register_insert ON "DeletionRegister"
  FOR INSERT
  WITH CHECK (true);
-- @@
REVOKE DELETE, TRUNCATE ON "ConsentText" FROM orya_app;
-- @@
REVOKE UPDATE, DELETE, TRUNCATE ON "DeletionRegister" FROM orya_app;
-- @@
-- 9. Bloc 4 : statut du bus (ecole), export des donnees (titulaire seul), droits (ecole + titulaire)
-- =============================================================================
ALTER TABLE "StudentBusStatus" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "StudentBusStatus" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS student_bus_status_isolation ON "StudentBusStatus";
-- @@
CREATE POLICY student_bus_status_isolation ON "StudentBusStatus"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "DataExportRequest" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "DataExportRequest" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS data_export_owner ON "DataExportRequest";
-- @@
-- L'ecole ne lit PAS les exports de ses membres : titulaire seul (et contexte systeme du job).
CREATE POLICY data_export_owner ON "DataExportRequest"
  FOR ALL
  USING (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
ALTER TABLE "DataRightsRequest" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "DataRightsRequest" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS data_rights_isolation ON "DataRightsRequest";
-- @@
CREATE POLICY data_rights_isolation ON "DataRightsRequest"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
-- 7. P0-3 : colonnes d'authentification de "User" invisibles pour orya_app
-- orya_app ne lit plus passwordHash, mfaSecret, mfaLastStep, failedLoginCount,
-- lockedUntil. La connexion et la MFA passent par deux fonctions SECURITY DEFINER
-- (un seul compte par appel, toujours une ligne). Les ecritures (INSERT/UPDATE)
-- restent permises. Retour arriere : prisma/sql/down/020_user_auth_columns_down.sql
-- Ce bloc doit rester APRES le GRANT SELECT ON ALL TABLES de la section 4.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON "User" FROM orya_app;
-- @@
REVOKE SELECT ("passwordHash", "mfaSecret", "mfaLastStep", "failedLoginCount", "lockedUntil") ON "User" FROM orya_app;
-- @@
GRANT SELECT ("id", "email", "locale", "status", "mfaEnrolledAt", "lastLoginAt", "activeProfileId", "deletedAt", "createdAt", "updatedAt") ON "User" TO orya_app;
-- @@
CREATE OR REPLACE FUNCTION public.orya_auth_credentials(p_email text)
RETURNS TABLE (
  found boolean,
  user_id uuid,
  password_hash text,
  status text,
  mfa_enrolled boolean,
  failed_login_count integer,
  locked_until timestamp(3),
  active_profile_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
  -- Toujours exactement UNE ligne (found = false et le reste NULL si l'e-mail est inconnu) :
  -- egalite stricte, aucun motif, aucune liste.
  SELECT u.id IS NOT NULL, u.id, u."passwordHash", u.status::text,
         u."mfaEnrolledAt" IS NOT NULL, u."failedLoginCount", u."lockedUntil", u."activeProfileId"
  FROM (SELECT 1) AS one
  LEFT JOIN public."User" AS u
    ON u.email = pg_catalog.lower(pg_catalog.btrim(p_email)) AND pg_catalog.length(p_email) <= 320
  LIMIT 1
$fn$;
-- @@
CREATE OR REPLACE FUNCTION public.orya_auth_mfa_state(p_user_id uuid)
RETURNS TABLE (
  found boolean,
  status text,
  mfa_secret text,
  mfa_enrolled_at timestamp(3),
  mfa_last_step integer,
  active_profile_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT u.id IS NOT NULL, u.status::text, u."mfaSecret", u."mfaEnrolledAt", u."mfaLastStep", u."activeProfileId"
  FROM (SELECT 1) AS one
  LEFT JOIN public."User" AS u ON u.id = p_user_id
  LIMIT 1
$fn$;
-- @@
REVOKE ALL ON FUNCTION public.orya_auth_credentials(text) FROM PUBLIC;
-- @@
REVOKE ALL ON FUNCTION public.orya_auth_mfa_state(uuid) FROM PUBLIC;
-- @@
GRANT EXECUTE ON FUNCTION public.orya_auth_credentials(text) TO orya_app;
-- @@
GRANT EXECUTE ON FUNCTION public.orya_auth_mfa_state(uuid) TO orya_app;
-- @@
DO $$
BEGIN
  -- Proprietaire restreint : orya_auth (NOLOGIN, sans bypass RLS), qui ne lit que "User".
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orya_auth') THEN
    EXECUTE 'GRANT SELECT ("id", "email", "passwordHash", "status", "mfaSecret", "mfaEnrolledAt", "mfaLastStep", "failedLoginCount", "lockedUntil", "activeProfileId") ON "User" TO orya_auth';
    EXECUTE 'ALTER FUNCTION public.orya_auth_credentials(text) OWNER TO orya_auth';
    EXECUTE 'ALTER FUNCTION public.orya_auth_mfa_state(uuid) OWNER TO orya_auth';
  ELSE
    RAISE EXCEPTION 'P0-3 BLOQUANT : role orya_auth absent, appliquer 000_roles.sql avant 010_rls.sql.';
  END IF;
END
$$;
-- @@
-- Test bloquant (A1) : le deploiement echoue si orya_auth ne possede pas les deux fonctions.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('orya_auth_credentials', 'orya_auth_mfa_state')
         AND pg_catalog.pg_get_userbyid(p.proowner) = 'orya_auth') <> 2 THEN
    RAISE EXCEPTION 'P0-3 BLOQUANT : orya_auth doit posseder orya_auth_credentials et orya_auth_mfa_state.';
  END IF;
END
$$;
-- @@

-- =============================================================================
-- Bloc 5 (Avenant n 1) : facturation ecole (contrat, factures, avoirs, virements).
-- Lecture : l'ecole voit SES documents ; ecriture : super-admin uniquement.
-- Documents emis et rapprochements IMMUABLES ; numerotation continue sans trou.
-- =============================================================================
-- @@
ALTER TABLE "SchoolContract" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "SchoolContract" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS school_contract_read ON "SchoolContract";
-- @@
CREATE POLICY school_contract_read ON "SchoolContract"
  FOR SELECT
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS school_contract_write ON "SchoolContract";
-- @@
CREATE POLICY school_contract_write ON "SchoolContract"
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'on')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@
ALTER TABLE "SchoolInvoice" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "SchoolInvoice" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS school_invoice_read ON "SchoolInvoice";
-- @@
CREATE POLICY school_invoice_read ON "SchoolInvoice"
  FOR SELECT
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS school_invoice_insert ON "SchoolInvoice";
-- @@
CREATE POLICY school_invoice_insert ON "SchoolInvoice"
  FOR INSERT
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@
ALTER TABLE "SchoolPayment" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "SchoolPayment" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS school_payment_read ON "SchoolPayment";
-- @@
CREATE POLICY school_payment_read ON "SchoolPayment"
  FOR SELECT
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );
-- @@
DROP POLICY IF EXISTS school_payment_insert ON "SchoolPayment";
-- @@
CREATE POLICY school_payment_insert ON "SchoolPayment"
  FOR INSERT
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@
ALTER TABLE "InvoiceSequence" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "InvoiceSequence" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS invoice_sequence_super ON "InvoiceSequence";
-- @@
CREATE POLICY invoice_sequence_super ON "InvoiceSequence"
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'on')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'on');
-- @@
-- Compteur : creation a 1 puis +1 exactement ; jamais de retour arriere ni de suppression.
CREATE OR REPLACE FUNCTION orya_invoice_sequence_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ORYA_INVOICE_SEQUENCE : suppression d''un compteur de numerotation interdite' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."lastValue" <> 1 THEN
    RAISE EXCEPTION 'ORYA_INVOICE_SEQUENCE : un compteur demarre a 1' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.series <> OLD.series OR NEW.year <> OLD.year OR NEW."lastValue" <> OLD."lastValue" + 1) THEN
    RAISE EXCEPTION 'ORYA_INVOICE_SEQUENCE : le compteur avance de 1 exactement' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
-- @@
DROP TRIGGER IF EXISTS invoice_sequence_guard ON "InvoiceSequence";
-- @@
CREATE TRIGGER invoice_sequence_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceSequence"
  FOR EACH ROW EXECUTE FUNCTION orya_invoice_sequence_guard();
-- @@
-- Document emis : insertion seulement, numero = dernier numero attribue DANS la transaction,
-- precedent present (aucun trou), format ORYA-<serie>-<annee>-<000001>, meme ecole partout.
CREATE OR REPLACE FUNCTION orya_school_invoice_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_last integer;
  v_school uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'ORYA_INVOICE_IMMUTABLE : document de facturation emis, modification et suppression interdites (emettre un avoir)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT "lastValue" INTO v_last FROM "InvoiceSequence" WHERE series = NEW.series AND year = NEW.year;
  IF v_last IS NULL OR NEW.seq <> v_last THEN
    RAISE EXCEPTION 'ORYA_INVOICE_NUMBER : numero non attribue par InvoiceSequence dans cette transaction' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.seq > 1 AND NOT EXISTS (
    SELECT 1 FROM "SchoolInvoice" WHERE series = NEW.series AND year = NEW.year AND seq = NEW.seq - 1
  ) THEN
    RAISE EXCEPTION 'ORYA_INVOICE_NUMBER : trou de numerotation refuse' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.number <> 'ORYA-' || NEW.series || '-' || NEW.year::text || '-' || lpad(NEW.seq::text, 6, '0') THEN
    RAISE EXCEPTION 'ORYA_INVOICE_NUMBER : format de numero invalide' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "schoolId" INTO v_school FROM "SchoolContract" WHERE id = NEW."contractId";
  IF v_school IS DISTINCT FROM NEW."schoolId" THEN
    RAISE EXCEPTION 'ORYA_INVOICE_SCHOOL : contrat d''une autre ecole' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."relatedInvoiceId" IS NOT NULL THEN
    SELECT "schoolId" INTO v_school FROM "SchoolInvoice" WHERE id = NEW."relatedInvoiceId" AND kind = 'invoice';
    IF v_school IS DISTINCT FROM NEW."schoolId" THEN
      RAISE EXCEPTION 'ORYA_INVOICE_SCHOOL : la facture liee doit etre la facture annuelle de la meme ecole' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
-- @@
DROP TRIGGER IF EXISTS school_invoice_guard ON "SchoolInvoice";
-- @@
CREATE TRIGGER school_invoice_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "SchoolInvoice"
  FOR EACH ROW EXECUTE FUNCTION orya_school_invoice_guard();
-- @@
CREATE OR REPLACE FUNCTION orya_billing_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ORYA_INVOICE_IMMUTABLE : TRUNCATE interdit sur %', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
-- @@
DROP TRIGGER IF EXISTS school_invoice_no_truncate ON "SchoolInvoice";
-- @@
CREATE TRIGGER school_invoice_no_truncate BEFORE TRUNCATE ON "SchoolInvoice" FOR EACH STATEMENT EXECUTE FUNCTION orya_billing_no_truncate();
-- @@
DROP TRIGGER IF EXISTS school_payment_no_truncate ON "SchoolPayment";
-- @@
CREATE TRIGGER school_payment_no_truncate BEFORE TRUNCATE ON "SchoolPayment" FOR EACH STATEMENT EXECUTE FUNCTION orya_billing_no_truncate();
-- @@
DROP TRIGGER IF EXISTS invoice_sequence_no_truncate ON "InvoiceSequence";
-- @@
CREATE TRIGGER invoice_sequence_no_truncate BEFORE TRUNCATE ON "InvoiceSequence" FOR EACH STATEMENT EXECUTE FUNCTION orya_billing_no_truncate();
-- @@
-- Rapprochement : insertion seulement, sur un document de la meme ecole (jamais un avoir).
CREATE OR REPLACE FUNCTION orya_school_payment_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_school uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'ORYA_PAYMENT_IMMUTABLE : rapprochement enregistre, modification et suppression interdites' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT "schoolId" INTO v_school FROM "SchoolInvoice" WHERE id = NEW."invoiceId" AND kind <> 'credit_note';
  IF v_school IS DISTINCT FROM NEW."schoolId" THEN
    RAISE EXCEPTION 'ORYA_PAYMENT_SCHOOL : facture introuvable pour cette ecole (ou avoir)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
-- @@
DROP TRIGGER IF EXISTS school_payment_guard ON "SchoolPayment";
-- @@
CREATE TRIGGER school_payment_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "SchoolPayment"
  FOR EACH ROW EXECUTE FUNCTION orya_school_payment_guard();
-- @@
-- Contrat : jamais supprime (les documents emis y sont rattaches).
CREATE OR REPLACE FUNCTION orya_school_contract_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ORYA_CONTRACT : suppression d''un contrat interdite' USING ERRCODE = 'insufficient_privilege';
END;
$$;
-- @@
DROP TRIGGER IF EXISTS school_contract_no_delete ON "SchoolContract";
-- @@
CREATE TRIGGER school_contract_no_delete BEFORE DELETE ON "SchoolContract" FOR EACH ROW EXECUTE FUNCTION orya_school_contract_no_delete();
-- @@
-- t62u B4 : etat des migrations pour la sonde de sante et le test de fumee de pre-production.
-- orya_app n'a aucun droit sur "_prisma_migrations" (REVOKE ci-dessus) : cette fonction
-- SECURITY DEFINER ne renvoie que des agregats (nombre appliquees, nombre en cours/echouees,
-- empreinte md5 des noms tries), jamais le contenu de la table.
CREATE OR REPLACE FUNCTION public.orya_migrations_state()
RETURNS TABLE (applied integer, pending integer, digest text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF pg_catalog.to_regclass('public."_prisma_migrations"') IS NULL THEN
    RETURN QUERY SELECT 0, 0, ''::text;
    RETURN;
  END IF;
  RETURN QUERY EXECUTE
    'SELECT (count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL))::integer, '
    || '(count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL))::integer, '
    || 'coalesce(pg_catalog.md5(pg_catalog.string_agg(migration_name, '','' ORDER BY migration_name) '
    || 'FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)), '''') '
    || 'FROM public."_prisma_migrations"';
END;
$fn$;
-- @@
REVOKE ALL ON FUNCTION public.orya_migrations_state() FROM PUBLIC;
-- @@
GRANT EXECUTE ON FUNCTION public.orya_migrations_state() TO orya_app;
-- @@

-- =============================================================================
-- F01 (t87u) : "PasswordResetToken" - meme isolation que "Device" (compte seul).
-- La demande publique ouvre le contexte d'identite du compte trouve par
-- orya_auth_credentials() ; la confirmation par l'identifiant porte par le jeton.
-- Un jeton presente sous une autre identite est invisible (refus).
-- =============================================================================
-- @@
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
-- @@
ALTER TABLE "PasswordResetToken" FORCE ROW LEVEL SECURITY;
-- @@
DROP POLICY IF EXISTS password_reset_isolation ON "PasswordResetToken";
-- @@
CREATE POLICY password_reset_isolation ON "PasswordResetToken"
  FOR ALL
  USING (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    "userId" = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
-- @@
GRANT SELECT, INSERT, UPDATE ON "PasswordResetToken" TO orya_app;
