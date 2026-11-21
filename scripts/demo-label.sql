-- Lot 10 : marque clairement les donnees de demonstration.
UPDATE "School" SET name = '[DEMO] ' || name WHERE name NOT LIKE '[DEMO]%';
INSERT INTO "AuditLog" (id, "schoolId", action, entity, severity, metadata, "createdAt")
SELECT gen_random_uuid(), id, 'demo.environment', 'School', 'info', '{"note":"Donnees fictives de demonstration"}'::jsonb, now() FROM "School";
