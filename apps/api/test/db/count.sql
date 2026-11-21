SELECT
  (SELECT count(*) FROM "School")         AS ecoles,
  (SELECT count(*) FROM "User")           AS comptes,
  (SELECT count(*) FROM "UserProfile")    AS profils,
  (SELECT count(*) FROM "Student")        AS eleves,
  (SELECT count(*) FROM "Guardian")       AS responsables,
  (SELECT count(*) FROM "StudentGuardian") AS liens,
  (SELECT count(*) FROM "Consent")        AS consentements;
