-- Fixture E2E : l'enseignant de l'ecole A est affecte a ATT-30 pour 2026-2027.
INSERT INTO "TeacherClassroomAssignment" ("schoolId", "teacherProfileId", "classroomId", "schoolYear", "updatedAt")
SELECT p."schoolId", p.id, 'a2000000-0000-4000-8000-000000000001', '2026-2027', now()
FROM "UserProfile" p JOIN "User" u ON u.id = p."userId"
WHERE u.email = 'professeur@ecole-a.orya.test' AND p.role = 'teacher'
ON CONFLICT DO NOTHING;
-- B07 : 2e compte direction de l'ecole B (meme empreinte de mot de passe jetable que direction@ecole-b),
-- pour enroler un second facteur distinct dans le projet Playwright mobile.
INSERT INTO "User" (email, "passwordHash", locale, status, "updatedAt")
SELECT 'direction-mobile@ecole-b.orya.test', u."passwordHash", u.locale, u.status, now()
FROM "User" u WHERE u.email = 'direction@ecole-b.orya.test'
ON CONFLICT (email) DO NOTHING;
INSERT INTO "UserProfile" ("userId", "schoolId", role, "displayName", "updatedAt")
SELECT n.id, p."schoolId", p.role, 'Direction mobile E2E', now()
FROM "User" n, "UserProfile" p JOIN "User" u ON u.id = p."userId"
WHERE n.email = 'direction-mobile@ecole-b.orya.test' AND u.email = 'direction@ecole-b.orya.test' AND p.role = 'direction'
ON CONFLICT DO NOTHING;
UPDATE "User" n SET "activeProfileId" = p.id FROM "UserProfile" p
WHERE p."userId" = n.id AND n.email = 'direction-mobile@ecole-b.orya.test' AND n."activeProfileId" IS NULL;
