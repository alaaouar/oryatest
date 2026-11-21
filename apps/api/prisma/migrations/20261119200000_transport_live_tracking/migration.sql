-- Migration: 20261119200000_transport_live_tracking
-- Module: Suivi en direct du transport scolaire (Loi 09-08 & CNDP)

-- 1. Enum ProfileRole: ajouter chauffeur
ALTER TYPE "ProfileRole" ADD VALUE IF NOT EXISTS 'chauffeur';

-- 2. Nouvelles énumérations
DO $$ BEGIN
  CREATE TYPE "TripDirection" AS ENUM ('pickup', 'dropoff');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "TripStatus" AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "StopEventType" AS ENUM ('arrived', 'departed', 'students_dropped');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3. Colonnes School
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "transportTrackingEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;

-- 4. Table BusVehicle
CREATE TABLE IF NOT EXISTS "BusVehicle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "model" TEXT,
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusVehicle_pkey" PRIMARY KEY ("id")
);

-- 5. Colonnes BusCircuit
ALTER TABLE "BusCircuit" ADD COLUMN IF NOT EXISTS "vehicleId" UUID;
ALTER TABLE "BusCircuit" ADD COLUMN IF NOT EXISTS "color" TEXT;

-- 6. Colonnes BusStop
ALTER TABLE "BusStop" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "BusStop" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "BusStop" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "BusStop" ADD COLUMN IF NOT EXISTS "radiusMeters" INTEGER NOT NULL DEFAULT 50;

-- 7. Table BusTrip
CREATE TABLE IF NOT EXISTS "BusTrip" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "circuitId" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "vehicleId" UUID,
    "direction" "TripDirection" NOT NULL DEFAULT 'dropoff',
    "status" "TripStatus" NOT NULL DEFAULT 'planned',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusTrip_pkey" PRIMARY KEY ("id")
);

-- 8. Table BusTripPosition
CREATE TABLE IF NOT EXISTS "BusTripPosition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusTripPosition_pkey" PRIMARY KEY ("id")
);

-- 9. Table BusTripStopEvent
CREATE TABLE IF NOT EXISTS "BusTripStopEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "stopId" UUID NOT NULL,
    "eventType" "StopEventType" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusTripStopEvent_pkey" PRIMARY KEY ("id")
);

-- 10. Table TransportNotificationLog
CREATE TABLE IF NOT EXISTS "TransportNotificationLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "stopId" UUID,
    "notificationType" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransportNotificationLog_pkey" PRIMARY KEY ("id")
);

-- 11. Index & Contraintes uniques
CREATE UNIQUE INDEX IF NOT EXISTS "BusVehicle_schoolId_plateNumber_key" ON "BusVehicle"("schoolId", "plateNumber");
CREATE INDEX IF NOT EXISTS "BusVehicle_schoolId_idx" ON "BusVehicle"("schoolId");

CREATE INDEX IF NOT EXISTS "BusCircuit_schoolId_vehicleId_idx" ON "BusCircuit"("schoolId", "vehicleId");

CREATE INDEX IF NOT EXISTS "BusTrip_schoolId_circuitId_status_idx" ON "BusTrip"("schoolId", "circuitId", "status");
CREATE INDEX IF NOT EXISTS "BusTrip_schoolId_driverProfileId_status_idx" ON "BusTrip"("schoolId", "driverProfileId", "status");

CREATE INDEX IF NOT EXISTS "BusTripPosition_schoolId_tripId_recordedAt_idx" ON "BusTripPosition"("schoolId", "tripId", "recordedAt" DESC);
CREATE INDEX IF NOT EXISTS "BusTripPosition_tripId_recordedAt_idx" ON "BusTripPosition"("tripId", "recordedAt" DESC);

CREATE INDEX IF NOT EXISTS "BusTripStopEvent_schoolId_tripId_idx" ON "BusTripStopEvent"("schoolId", "tripId");
CREATE INDEX IF NOT EXISTS "BusTripStopEvent_tripId_stopId_idx" ON "BusTripStopEvent"("tripId", "stopId");

CREATE UNIQUE INDEX IF NOT EXISTS "TransportNotificationLog_tripId_studentId_notificationType_key" ON "TransportNotificationLog"("tripId", "studentId", "notificationType");
CREATE INDEX IF NOT EXISTS "TransportNotificationLog_schoolId_tripId_idx" ON "TransportNotificationLog"("schoolId", "tripId");

-- 12. Clés étrangères
DO $$ BEGIN
  ALTER TABLE "BusVehicle" ADD CONSTRAINT "BusVehicle_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusCircuit" ADD CONSTRAINT "BusCircuit_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "BusVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusTrip" ADD CONSTRAINT "BusTrip_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusTrip" ADD CONSTRAINT "BusTrip_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "BusCircuit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusTrip" ADD CONSTRAINT "BusTrip_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusTrip" ADD CONSTRAINT "BusTrip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "BusVehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusTripPosition" ADD CONSTRAINT "BusTripPosition_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusTripPosition" ADD CONSTRAINT "BusTripPosition_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "BusTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusTripStopEvent" ADD CONSTRAINT "BusTripStopEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusTripStopEvent" ADD CONSTRAINT "BusTripStopEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "BusTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "BusTripStopEvent" ADD CONSTRAINT "BusTripStopEvent_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "BusStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "TransportNotificationLog" ADD CONSTRAINT "TransportNotificationLog_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "TransportNotificationLog" ADD CONSTRAINT "TransportNotificationLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "BusTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "TransportNotificationLog" ADD CONSTRAINT "TransportNotificationLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "TransportNotificationLog" ADD CONSTRAINT "TransportNotificationLog_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "BusStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 13. Row-Level Security (RLS) sur les 5 nouvelles tables
ALTER TABLE "BusVehicle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusVehicle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bus_vehicle_isolation ON "BusVehicle";
CREATE POLICY bus_vehicle_isolation ON "BusVehicle"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );

ALTER TABLE "BusTrip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusTrip" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bus_trip_isolation ON "BusTrip";
CREATE POLICY bus_trip_isolation ON "BusTrip"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );

ALTER TABLE "BusTripPosition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusTripPosition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bus_trip_position_isolation ON "BusTripPosition";
CREATE POLICY bus_trip_position_isolation ON "BusTripPosition"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );

ALTER TABLE "BusTripStopEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BusTripStopEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bus_trip_stop_event_isolation ON "BusTripStopEvent";
CREATE POLICY bus_trip_stop_event_isolation ON "BusTripStopEvent"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );

ALTER TABLE "TransportNotificationLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TransportNotificationLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transport_notification_log_isolation ON "TransportNotificationLog";
CREATE POLICY transport_notification_log_isolation ON "TransportNotificationLog"
  FOR ALL
  USING (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  )
  WITH CHECK (
    "schoolId" = NULLIF(current_setting('app.school_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'on'
  );

-- 14. Privilèges applicatifs pour le rôle PostgreSQL orya_app
GRANT SELECT, INSERT, UPDATE, DELETE ON "BusVehicle" TO orya_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "BusTrip" TO orya_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "BusTripPosition" TO orya_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "BusTripStopEvent" TO orya_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "TransportNotificationLog" TO orya_app;
