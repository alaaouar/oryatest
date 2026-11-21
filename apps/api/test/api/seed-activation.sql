INSERT INTO "Student" (id, "schoolId", "studentCode", "displayName", "createdAt", "updatedAt")
VALUES ('fa000000-0000-4000-8000-000000000001',
        '0a000000-0000-4000-8000-000000000001',
        'ACTIV-001',
        'Eleve activation',
        now(), now())
ON CONFLICT (id) DO NOTHING;