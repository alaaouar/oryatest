-- Lot 2.3 - protection des registres de presence.
-- Non destructive : aucune donnee modifiee. On remplace uniquement le
-- comportement ON DELETE CASCADE par RESTRICT pour qu'une suppression de
-- classe, d'eleve ou de session ne puisse plus effacer silencieusement
-- l'historique d'appel. La suppression d'une ecole (School) reste en cascade.

ALTER TABLE "AttendanceSession" DROP CONSTRAINT "AttendanceSession_classroomId_fkey";
ALTER TABLE "AttendanceSession"
  ADD CONSTRAINT "AttendanceSession_classroomId_fkey"
  FOREIGN KEY ("classroomId") REFERENCES "Classroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendanceRow" DROP CONSTRAINT "AttendanceRow_sessionId_fkey";
ALTER TABLE "AttendanceRow"
  ADD CONSTRAINT "AttendanceRow_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AttendanceRow" DROP CONSTRAINT "AttendanceRow_studentId_fkey";
ALTER TABLE "AttendanceRow"
  ADD CONSTRAINT "AttendanceRow_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;