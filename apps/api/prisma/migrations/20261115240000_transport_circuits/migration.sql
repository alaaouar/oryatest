-- t92 transport : circuits (BusCircuit), arrets (BusStop) et affectation eleve -> circuit/arret (BusCircuitStudent).
-- Aucune position ni coordonnee (carte exclue par decision). RLS : prisma/sql/010_rls.sql.
-- CreateTable
CREATE TABLE "BusCircuit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "attendantProfileId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusCircuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusStop" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "circuitId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusCircuitStudent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schoolId" UUID NOT NULL,
    "circuitId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "stopId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusCircuitStudent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusCircuit_schoolId_attendantProfileId_idx" ON "BusCircuit"("schoolId", "attendantProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "BusCircuit_schoolId_name_key" ON "BusCircuit"("schoolId", "name");

-- CreateIndex
CREATE INDEX "BusStop_schoolId_idx" ON "BusStop"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "BusStop_circuitId_position_key" ON "BusStop"("circuitId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "BusCircuitStudent_studentId_key" ON "BusCircuitStudent"("studentId");

-- CreateIndex
CREATE INDEX "BusCircuitStudent_schoolId_circuitId_idx" ON "BusCircuitStudent"("schoolId", "circuitId");

-- AddForeignKey
ALTER TABLE "BusCircuit" ADD CONSTRAINT "BusCircuit_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusCircuit" ADD CONSTRAINT "BusCircuit_attendantProfileId_fkey" FOREIGN KEY ("attendantProfileId") REFERENCES "UserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusStop" ADD CONSTRAINT "BusStop_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusStop" ADD CONSTRAINT "BusStop_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "BusCircuit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusCircuitStudent" ADD CONSTRAINT "BusCircuitStudent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusCircuitStudent" ADD CONSTRAINT "BusCircuitStudent_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "BusCircuit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusCircuitStudent" ADD CONSTRAINT "BusCircuitStudent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusCircuitStudent" ADD CONSTRAINT "BusCircuitStudent_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "BusStop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

