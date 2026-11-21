-- Fixture Lot 2.2 : classe de 30 élèves + classe sans affectation (école A).
-- Identifiants déterministes hors plage du seed Lot 1 (préfixe a2…).

INSERT INTO "Classroom" (id, "schoolId", name, cycle, level, "createdAt", "updatedAt") VALUES
  ('a2000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'ATT-30', 'Collège', '6e', now(), now()),
  ('a2000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', 'ATT-INTERDITE', 'Collège', '5e', now(), now()),
  ('a2000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000002', 'ATT-B', 'Collège', '6e', now(), now())
ON CONFLICT DO NOTHING;

DO $$
DECLARE
  i integer;
  sid uuid;
BEGIN
  FOR i IN 1..30 LOOP
    sid := ('a2100000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid;
    INSERT INTO "Student" (id, "schoolId", "studentCode", "displayName", "createdAt", "updatedAt")
    VALUES (
      sid,
      '0a000000-0000-4000-8000-000000000001',
      'ATT-' || lpad(i::text, 3, '0'),
      'Élève Appel ' || i,
      now(),
      now()
    )
    ON CONFLICT DO NOTHING;

    INSERT INTO "Enrollment" (id, "schoolId", "studentId", "classroomId", "schoolYear", "createdAt")
    VALUES (
      ('a2200000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
      '0a000000-0000-4000-8000-000000000001',
      sid,
      'a2000000-0000-4000-8000-000000000001',
      '2026-2027',
      now()
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END
$$;
