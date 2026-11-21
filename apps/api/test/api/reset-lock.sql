UPDATE "User"
SET "failedLoginCount" = 0, "lockedUntil" = NULL
WHERE email = 'parent2@ecole-a.orya.test';
