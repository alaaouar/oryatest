SELECT
  c.relname                          AS table_name,
  c.relrowsecurity                  AS rls_active,
  c.relforcerowsecurity             AS force_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

SELECT count(*) AS policies FROM pg_policies WHERE schemaname = 'public';
SELECT count(*) AS triggers FROM pg_trigger WHERE NOT tgisinternal;
