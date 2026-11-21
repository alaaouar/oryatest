-- Lot 7 : index du tableau de bord direction (non destructif).
-- CreateIndex
CREATE INDEX "Enrollment_schoolId_schoolYear_classroomId_idx" ON "Enrollment"("schoolId", "schoolYear", "classroomId");

-- CreateIndex
CREATE INDEX "ParentAction_schoolId_status_idx" ON "ParentAction"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AgendaItem_schoolId_authorId_createdAt_idx" ON "AgendaItem"("schoolId", "authorId", "createdAt");
