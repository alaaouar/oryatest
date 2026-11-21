-- =============================================================================
-- ORYA - Bloc 5 (Avenant n 1) : verification base de la facturation ecole.
-- Base FRAICHE (migration + 010_rls.sql), sans seed. Identifiants prefixes f5b...
-- Numerotation continue sans trou (transactionnelle), documents immuables,
-- rapprochements immuables, RLS (lecture par ecole, ecriture super-admin).
-- Chaque test affiche "B5DBn OK" ; un echec interrompt l'execution.
-- =============================================================================
\set ON_ERROR_STOP on

INSERT INTO "School" (id, name, city, code, status, "createdAt", "updatedAt") VALUES
  ('f5b00000-0000-4000-8000-000000000001', 'Ecole Facturation A', 'Rabat', 'F5BA01', 'active', now(), now()),
  ('f5b00000-0000-4000-8000-000000000002', 'Ecole Facturation B', 'Fes',   'F5BB01', 'active', now(), now());
INSERT INTO "SchoolContract" (id, "schoolId", reference, "updatedAt") VALUES
  ('f5b10000-0000-4000-8000-000000000001', 'f5b00000-0000-4000-8000-000000000001', 'CTR-TEST-A', now()),
  ('f5b10000-0000-4000-8000-000000000002', 'f5b00000-0000-4000-8000-000000000002', 'CTR-TEST-B', now());

DO $$
BEGIN
  IF (SELECT "unitPriceHtMinor" || '/' || "vatRateBp" || '/' || "unitPriceTtcMinor" FROM "SchoolContract" WHERE reference = 'CTR-TEST-A') <> '10000/2000/12000' THEN
    RAISE EXCEPTION 'B5DB0 FAIL - prix par defaut attendu 100 DH HT / 20 %% / 120 DH TTC';
  END IF;
  RAISE NOTICE 'B5DB0 OK - contrat par defaut : 100 DH HT, TVA 20 %%, 120 DH TTC';
END $$;

SET ROLE orya_app;
SELECT set_config('app.is_super_admin', 'on', false);
SELECT set_config('app.school_id', '', false);

-- B5DB1 : premiere facture annuelle, numero 1 attribue dans la meme transaction.
BEGIN;
INSERT INTO "InvoiceSequence" (series, year, "lastValue") VALUES ('FA', 2026, 1)
  ON CONFLICT (series, year) DO UPDATE SET "lastValue" = "InvoiceSequence"."lastValue" + 1;
INSERT INTO "SchoolInvoice" (id, "schoolId", "contractId", kind, number, series, year, seq, "annualKey", "schoolYear", "referenceDate", "dueDate",
  quantity, "unitPriceHtMinor", "vatRateBp", "totalHtMinor", "totalVatMinor", "totalTtcMinor", "countedStudentIds", issuer, client)
VALUES ('f5b20000-0000-4000-8000-000000000001', 'f5b00000-0000-4000-8000-000000000001', 'f5b10000-0000-4000-8000-000000000001', 'invoice',
  'ORYA-FA-2026-000001', 'FA', 2026, 1, 'f5b00000-0000-4000-8000-000000000001:2026-2027', '2026-2027', '2026-10-31', '2026-12-01',
  3, 10000, 2000, 30000, 6000, 36000, '[]', '{}', '{}');
COMMIT;
DO $$ BEGIN
  IF (SELECT count(*) FROM "SchoolInvoice") <> 1 THEN RAISE EXCEPTION 'B5DB1 FAIL'; END IF;
  RAISE NOTICE 'B5DB1 OK - facture ORYA-FA-2026-000001 emise (3 x 120 DH TTC = 360 DH)';
END $$;

-- B5DB2 / B5DB3 : facture emise immuable. Couche 1 (role applicatif, meme super-admin) : aucune
-- politique UPDATE/DELETE, 0 ligne touchee. Couche 2 (proprietaire) : trigger, voir B5DB2b/B5DB3b.
DO $$
DECLARE n integer;
BEGIN
  UPDATE "SchoolInvoice" SET quantity = 2 WHERE seq = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 OR (SELECT quantity FROM "SchoolInvoice" WHERE seq = 1 AND series = 'FA') <> 3 THEN RAISE EXCEPTION 'B5DB2 FAIL - facture emise modifiee'; END IF;
  RAISE NOTICE 'B5DB2 OK - orya_app (super-admin) : modification d''une facture emise sans effet (0 ligne, aucune politique UPDATE)';
  DELETE FROM "SchoolInvoice" WHERE seq = 1;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'B5DB3 FAIL - facture emise supprimee'; END IF;
  RAISE NOTICE 'B5DB3 OK - orya_app : suppression d''une facture emise sans effet (0 ligne)';
END $$;

-- B5DB4 : une emission annulee (ROLLBACK) ne consomme aucun numero.
BEGIN;
INSERT INTO "InvoiceSequence" (series, year, "lastValue") VALUES ('FA', 2026, 1)
  ON CONFLICT (series, year) DO UPDATE SET "lastValue" = "InvoiceSequence"."lastValue" + 1;
INSERT INTO "SchoolInvoice" (id, "schoolId", "contractId", kind, number, series, year, seq, "relatedInvoiceId", "schoolYear", "referenceDate", "dueDate",
  quantity, "unitPriceHtMinor", "vatRateBp", "totalHtMinor", "totalVatMinor", "totalTtcMinor", "countedStudentIds", issuer, client)
VALUES ('f5b20000-0000-4000-8000-000000000099', 'f5b00000-0000-4000-8000-000000000001', 'f5b10000-0000-4000-8000-000000000001', 'complementary',
  'ORYA-FA-2026-000002', 'FA', 2026, 2, 'f5b20000-0000-4000-8000-000000000001', '2026-2027', '2026-10-31', '2026-12-01',
  1, 10000, 2000, 10000, 2000, 12000, '[]', '{}', '{}');
ROLLBACK;
DO $$ BEGIN
  IF (SELECT "lastValue" FROM "InvoiceSequence" WHERE series = 'FA' AND year = 2026) <> 1 THEN RAISE EXCEPTION 'B5DB4 FAIL - numero consomme par une transaction annulee'; END IF;
  RAISE NOTICE 'B5DB4 OK - ROLLBACK : compteur FA-2026 reste a 1 (aucun trou)';
END $$;

-- B5DB5 : deux numeros pris, un seul document insere -> trou refuse.
DO $$ BEGIN
  BEGIN
    UPDATE "InvoiceSequence" SET "lastValue" = "lastValue" + 1 WHERE series = 'FA' AND year = 2026;
    UPDATE "InvoiceSequence" SET "lastValue" = "lastValue" + 1 WHERE series = 'FA' AND year = 2026;
    INSERT INTO "SchoolInvoice" (id, "schoolId", "contractId", kind, number, series, year, seq, "relatedInvoiceId", "schoolYear", "referenceDate", "dueDate",
      quantity, "unitPriceHtMinor", "vatRateBp", "totalHtMinor", "totalVatMinor", "totalTtcMinor", "countedStudentIds", issuer, client)
    VALUES (gen_random_uuid(), 'f5b00000-0000-4000-8000-000000000001', 'f5b10000-0000-4000-8000-000000000001', 'complementary',
      'ORYA-FA-2026-000003', 'FA', 2026, 3, 'f5b20000-0000-4000-8000-000000000001', '2026-2027', '2026-10-31', '2026-12-01',
      1, 10000, 2000, 10000, 2000, 12000, '[]', '{}', '{}');
    RAISE EXCEPTION 'B5DB5 FAIL - trou de numerotation accepte';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'B5DB5 OK - trou de numerotation refuse (ORYA_INVOICE_NUMBER)';
  END;
  IF (SELECT "lastValue" FROM "InvoiceSequence" WHERE series = 'FA' AND year = 2026) <> 1 THEN RAISE EXCEPTION 'B5DB5 FAIL - compteur non restaure'; END IF;
END $$;

-- B5DB6 : numero non attribue par le compteur -> refuse.
DO $$ BEGIN
  BEGIN
    INSERT INTO "SchoolInvoice" (id, "schoolId", "contractId", kind, number, series, year, seq, "relatedInvoiceId", "schoolYear", "referenceDate", "dueDate",
      quantity, "unitPriceHtMinor", "vatRateBp", "totalHtMinor", "totalVatMinor", "totalTtcMinor", "countedStudentIds", issuer, client)
    VALUES (gen_random_uuid(), 'f5b00000-0000-4000-8000-000000000001', 'f5b10000-0000-4000-8000-000000000001', 'complementary',
      'ORYA-FA-2026-000009', 'FA', 2026, 9, 'f5b20000-0000-4000-8000-000000000001', '2026-2027', '2026-10-31', '2026-12-01',
      1, 10000, 2000, 10000, 2000, 12000, '[]', '{}', '{}');
    RAISE EXCEPTION 'B5DB6 FAIL - numero arbitraire accepte';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'B5DB6 OK - numero hors compteur refuse';
  END;
END $$;

-- B5DB7 : le compteur ne recule pas et ne saute pas.
DO $$ BEGIN
  BEGIN
    UPDATE "InvoiceSequence" SET "lastValue" = 0 WHERE series = 'FA' AND year = 2026;
    RAISE EXCEPTION 'B5DB7 FAIL - compteur recule';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'B5DB7 OK - recul du compteur refuse';
  END;
  BEGIN
    UPDATE "InvoiceSequence" SET "lastValue" = "lastValue" + 5 WHERE series = 'FA' AND year = 2026;
    RAISE EXCEPTION 'B5DB7 FAIL - compteur saute';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'B5DB7b OK - saut du compteur refuse';
  END;
  BEGIN
    DELETE FROM "InvoiceSequence" WHERE series = 'FA';
    RAISE EXCEPTION 'B5DB7 FAIL - compteur supprime';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'B5DB7c OK - suppression du compteur refusee';
  END;
END $$;

-- B5DB8 : format de numero et montants controles.
DO $$ BEGIN
  BEGIN
    UPDATE "InvoiceSequence" SET "lastValue" = "lastValue" + 1 WHERE series = 'FA' AND year = 2026;
    INSERT INTO "SchoolInvoice" (id, "schoolId", "contractId", kind, number, series, year, seq, "relatedInvoiceId", "schoolYear", "referenceDate", "dueDate",
      quantity, "unitPriceHtMinor", "vatRateBp", "totalHtMinor", "totalVatMinor", "totalTtcMinor", "countedStudentIds", issuer, client)
    VALUES (gen_random_uuid(), 'f5b00000-0000-4000-8000-000000000001', 'f5b10000-0000-4000-8000-000000000001', 'complementary',
      'FACT-2', 'FA', 2026, 2, 'f5b20000-0000-4000-8000-000000000001', '2026-2027', '2026-10-31', '2026-12-01',
      1, 10000, 2000, 10000, 2000, 12000, '[]', '{}', '{}');
    RAISE EXCEPTION 'B5DB8 FAIL - format libre accepte';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'B5DB8 OK - format de numero impose (ORYA-FA-AAAA-000001)';
  END;
  BEGIN
    UPDATE "InvoiceSequence" SET "lastValue" = "lastValue" + 1 WHERE series = 'FA' AND year = 2026;
    INSERT INTO "SchoolInvoice" (id, "schoolId", "contractId", kind, number, series, year, seq, "relatedInvoiceId", "schoolYear", "referenceDate", "dueDate",
      quantity, "unitPriceHtMinor", "vatRateBp", "totalHtMinor", "totalVatMinor", "totalTtcMinor", "countedStudentIds", issuer, client)
    VALUES (gen_random_uuid(), 'f5b00000-0000-4000-8000-000000000001', 'f5b10000-0000-4000-8000-000000000001', 'complementary',
      'ORYA-FA-2026-000002', 'FA', 2026, 2, 'f5b20000-0000-4000-8000-000000000001', '2026-2027', '2026-10-31', '2026-12-01',
      1, 10000, 2000, 10000, 2000, 11000, '[]', '{}', '{}');
    RAISE EXCEPTION 'B5DB8 FAIL - TTC incoherent accepte';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'B5DB8b OK - TTC <> HT + TVA refuse (SchoolInvoice_amounts_chk)';
  END;
END $$;

-- B5DB9 : une seule facture annuelle par ecole et par annee scolaire.
DO $$ BEGIN
  BEGIN
    UPDATE "InvoiceSequence" SET "lastValue" = "lastValue" + 1 WHERE series = 'FA' AND year = 2026;
    INSERT INTO "SchoolInvoice" (id, "schoolId", "contractId", kind, number, series, year, seq, "annualKey", "schoolYear", "referenceDate", "dueDate",
      quantity, "unitPriceHtMinor", "vatRateBp", "totalHtMinor", "totalVatMinor", "totalTtcMinor", "countedStudentIds", issuer, client)
    VALUES (gen_random_uuid(), 'f5b00000-0000-4000-8000-000000000001', 'f5b10000-0000-4000-8000-000000000001', 'invoice',
      'ORYA-FA-2026-000002', 'FA', 2026, 2, 'f5b00000-0000-4000-8000-000000000001:2026-2027', '2026-2027', '2026-10-31', '2026-12-01',
      1, 10000, 2000, 10000, 2000, 12000, '[]', '{}', '{}');
    RAISE EXCEPTION 'B5DB9 FAIL - deuxieme facture annuelle acceptee';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'B5DB9 OK - deuxieme facture annuelle refusee (annualKey unique)';
  END;
END $$;

-- B5DB10 : avoir (serie AV, numerotation propre) puis rapprochements.
BEGIN;
INSERT INTO "InvoiceSequence" (series, year, "lastValue") VALUES ('AV', 2026, 1)
  ON CONFLICT (series, year) DO UPDATE SET "lastValue" = "InvoiceSequence"."lastValue" + 1;
INSERT INTO "SchoolInvoice" (id, "schoolId", "contractId", kind, number, series, year, seq, "relatedInvoiceId", "schoolYear", "referenceDate", "dueDate",
  quantity, "unitPriceHtMinor", "vatRateBp", "totalHtMinor", "totalVatMinor", "totalTtcMinor", "countedStudentIds", issuer, client, reason)
VALUES ('f5b20000-0000-4000-8000-000000000002', 'f5b00000-0000-4000-8000-000000000001', 'f5b10000-0000-4000-8000-000000000001', 'credit_note',
  'ORYA-AV-2026-000001', 'AV', 2026, 1, 'f5b20000-0000-4000-8000-000000000001', '2026-2027', '2026-10-31', '2026-12-01',
  1, 10000, 2000, 10000, 2000, 12000, '[]', '{}', '{}', 'eleve compte a tort');
COMMIT;
INSERT INTO "SchoolPayment" (id, "schoolId", "invoiceId", "amountMinor", "receivedOn", "bankReference", "recordedById")
VALUES ('f5b30000-0000-4000-8000-000000000001', 'f5b00000-0000-4000-8000-000000000001', 'f5b20000-0000-4000-8000-000000000001', 24000, '2026-11-15', 'VIR-FICTIF-0001', 'f5b00000-0000-4000-8000-000000000009');
DO $$ BEGIN
  RAISE NOTICE 'B5DB10 OK - avoir ORYA-AV-2026-000001 (serie distincte) et virement rapproche';
  UPDATE "SchoolPayment" SET "amountMinor" = 1 WHERE id = 'f5b30000-0000-4000-8000-000000000001';
  IF (SELECT "amountMinor" FROM "SchoolPayment" WHERE id = 'f5b30000-0000-4000-8000-000000000001') <> 24000 THEN RAISE EXCEPTION 'B5DB11 FAIL - rapprochement modifie'; END IF;
  RAISE NOTICE 'B5DB11 OK - orya_app : rapprochement non modifiable (0 ligne)';
  BEGIN
    INSERT INTO "SchoolPayment" ("schoolId", "invoiceId", "amountMinor", "receivedOn", "bankReference", "recordedById")
    VALUES ('f5b00000-0000-4000-8000-000000000001', 'f5b20000-0000-4000-8000-000000000002', 100, '2026-11-15', 'VIR-FICTIF-0002', 'f5b00000-0000-4000-8000-000000000009');
    RAISE EXCEPTION 'B5DB12 FAIL - paiement sur un avoir accepte';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'B5DB12 OK - paiement sur un avoir refuse';
  END;
  BEGIN
    INSERT INTO "SchoolPayment" ("schoolId", "invoiceId", "amountMinor", "receivedOn", "bankReference", "recordedById")
    VALUES ('f5b00000-0000-4000-8000-000000000002', 'f5b20000-0000-4000-8000-000000000001', 100, '2026-11-15', 'VIR-FICTIF-0003', 'f5b00000-0000-4000-8000-000000000009');
    RAISE EXCEPTION 'B5DB12b FAIL - paiement croise entre ecoles accepte';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'B5DB12b OK - paiement sur la facture d''une autre ecole refuse';
  END;
  BEGIN
    DELETE FROM "SchoolContract" WHERE reference = 'CTR-TEST-B';
    RAISE EXCEPTION 'B5DB13 FAIL - contrat supprime';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'B5DB13 OK - suppression de contrat refusee';
  END;
END $$;

-- B5DB14 : RLS - lecture limitee a l'ecole, aucune ecriture hors super-admin.
SELECT set_config('app.is_super_admin', 'off', false);
SELECT set_config('app.school_id', 'f5b00000-0000-4000-8000-000000000002', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM "SchoolInvoice") <> 0 OR (SELECT count(*) FROM "SchoolPayment") <> 0 THEN RAISE EXCEPTION 'B5DB14 FAIL - fuite inter-ecoles'; END IF;
  IF (SELECT count(*) FROM "SchoolContract") <> 1 THEN RAISE EXCEPTION 'B5DB14 FAIL - contrat de l''ecole non visible'; END IF;
  RAISE NOTICE 'B5DB14 OK - ecole B : 0 facture et 0 virement de l''ecole A visibles, son seul contrat visible';
END $$;
SELECT set_config('app.school_id', 'f5b00000-0000-4000-8000-000000000001', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM "SchoolInvoice") <> 2 OR (SELECT count(*) FROM "SchoolPayment") <> 1 THEN RAISE EXCEPTION 'B5DB15 FAIL - documents de l''ecole A non visibles'; END IF;
  RAISE NOTICE 'B5DB15 OK - ecole A : ses 2 documents et son virement visibles';
  BEGIN
    INSERT INTO "InvoiceSequence" (series, year, "lastValue") VALUES ('FA', 2027, 1);
    RAISE EXCEPTION 'B5DB16 FAIL - numerotation par un role ecole';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'B5DB16 OK - un role ecole ne peut pas attribuer de numero (RLS)';
  END;
  BEGIN
    UPDATE "SchoolContract" SET "noticeDays" = 300;
    IF EXISTS (SELECT 1 FROM "SchoolContract" WHERE "noticeDays" = 300) THEN RAISE EXCEPTION 'B5DB17 FAIL - contrat modifie par l''ecole'; END IF;
    RAISE NOTICE 'B5DB17 OK - la direction ne modifie pas son contrat (0 ligne, RLS)';
  END;
END $$;
RESET ROLE;

-- B5DB18 : couche trigger, active meme pour le proprietaire / superutilisateur (hors RLS).
DO $$ BEGIN
  BEGIN
    UPDATE "SchoolInvoice" SET quantity = 2 WHERE seq = 1 AND series = 'FA';
    RAISE EXCEPTION 'B5DB2b FAIL - facture modifiee par le proprietaire';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'B5DB2b OK - proprietaire : modification refusee (ORYA_INVOICE_IMMUTABLE)';
  END;
  BEGIN
    DELETE FROM "SchoolInvoice" WHERE seq = 1 AND series = 'AV';
    RAISE EXCEPTION 'B5DB3b FAIL - avoir supprime par le proprietaire';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'B5DB3b OK - proprietaire : suppression d''un avoir refusee';
  END;
  BEGIN
    UPDATE "SchoolPayment" SET "amountMinor" = 1;
    RAISE EXCEPTION 'B5DB11b FAIL - rapprochement modifie par le proprietaire';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'B5DB11b OK - proprietaire : rapprochement immuable (ORYA_PAYMENT_IMMUTABLE)';
  END;
  BEGIN
    TRUNCATE "SchoolInvoice" CASCADE;
    RAISE EXCEPTION 'B5DB18 FAIL - TRUNCATE accepte';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'B5DB18 OK - TRUNCATE des factures refuse';
  END;
END $$;
INSERT INTO "Student" (id, "schoolId", "studentCode", "displayName", "createdAt", "updatedAt") VALUES
  ('f5b40000-0000-4000-8000-000000000001', 'f5b00000-0000-4000-8000-000000000001', 'F5B-001', 'Eleve F5B', now(), now());
INSERT INTO "Classroom" (id, "schoolId", name, "createdAt", "updatedAt") VALUES
  ('f5b50000-0000-4000-8000-000000000001', 'f5b00000-0000-4000-8000-000000000001', 'F5B-CM1', now(), now());
DO $$ BEGIN
  BEGIN
    INSERT INTO "Enrollment" ("schoolId", "studentId", "classroomId", "schoolYear", "startsOn", "endsOn")
    VALUES ('f5b00000-0000-4000-8000-000000000001', 'f5b40000-0000-4000-8000-000000000001', 'f5b50000-0000-4000-8000-000000000001', '2026-2027', '2026-11-01', '2026-10-01');
    RAISE EXCEPTION 'B5DB19 FAIL - sortie avant entree acceptee';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'B5DB19 OK - date de sortie anterieure a l''entree refusee';
  END;
END $$;