-- ORYA - jeu de demonstration du module presences (base locale orya_v2 uniquement).
-- Additif et idempotent : INSERT ... ON CONFLICT DO NOTHING, aucune suppression.
-- Ecole A du seed : 2 classes, 32 eleves inscrits pour 2026-2027,
-- enseignant du seed affecte a la classe 6e A.

INSERT INTO "Classroom" (id, "schoolId", name, cycle, level, "createdAt", "updatedAt") VALUES
  ('de000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '6e A', 'Collège', '6e', now(), now()),
  ('de000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', '5e B', 'Collège', '5e', now(), now())
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  i integer;
  sid uuid;
  first_names text[] := ARRAY['Yasmine','Adam','Salma','Youssef','Imane','Omar','Lina','Mehdi','Nour','Rayan',
                              'Aya','Hamza','Sara','Ilyas','Malak','Anas','Hiba','Zakaria','Rim','Amine',
                              'Chaima','Ayoub','Douae','Ismail','Kenza','Bilal','Meryem','Walid','Ghita','Saad'];
  last_names text[] := ARRAY['El Amrani','Benali','Alaoui','Bennani','Tazi','Idrissi','Berrada','Chraibi','Fassi','Lahlou'];
BEGIN
  FOR i IN 1..30 LOOP
    sid := ('de100000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    INSERT INTO "Student" (id, "schoolId", "studentCode", "displayName", "createdAt", "updatedAt")
    VALUES (sid, '0a000000-0000-4000-8000-000000000001', 'DEMO-' || lpad(i::text, 3, '0'),
            first_names[i] || ' ' || last_names[1 + (i % 10)], now(), now())
    ON CONFLICT DO NOTHING;

    INSERT INTO "Enrollment" (id, "schoolId", "studentId", "classroomId", "schoolYear", "createdAt")
    VALUES (('de200000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
            '0a000000-0000-4000-8000-000000000001', sid,
            CASE WHEN i <= 18 THEN 'de000000-0000-4000-8000-000000000001'::uuid
                 ELSE 'de000000-0000-4000-8000-000000000002'::uuid END,
            '2026-2027', now())
    ON CONFLICT DO NOTHING;
  END LOOP;
END
$$;

-- Les 2 eleves du seed Lot 1 (ecole A) rejoignent la 6e A s'ils n'ont pas de classe.
INSERT INTO "Enrollment" (id, "schoolId", "studentId", "classroomId", "schoolYear", "createdAt")
SELECT gen_random_uuid(), s."schoolId", s.id, 'de000000-0000-4000-8000-000000000001', '2026-2027', now()
FROM "Student" s
WHERE s."schoolId" = '0a000000-0000-4000-8000-000000000001'
  AND s."studentCode" LIKE 'ECOLE-A-%'
ON CONFLICT DO NOTHING;

INSERT INTO "TeacherClassroomAssignment" (id, "schoolId", "teacherProfileId", "classroomId", "schoolYear", "createdAt", "updatedAt")
SELECT 'de300000-0000-4000-8000-000000000001', p."schoolId", p.id, 'de000000-0000-4000-8000-000000000001', '2026-2027', now(), now()
FROM "UserProfile" p
WHERE p."schoolId" = '0a000000-0000-4000-8000-000000000001' AND p.role = 'teacher'
ORDER BY p."createdAt"
LIMIT 1
ON CONFLICT DO NOTHING;