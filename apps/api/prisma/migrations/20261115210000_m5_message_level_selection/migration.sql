-- t92 M5 : messages cibles par niveau (Classroom.level) et par selection d'eleves.
-- Non destructif : valeurs d'enum ajoutees, colonnes nullables / par defaut vides.
ALTER TYPE "MessageAudience" ADD VALUE 'level';
ALTER TYPE "MessageAudience" ADD VALUE 'selection';

ALTER TABLE "Message" ADD COLUMN     "level" TEXT,
ADD COLUMN     "targetStudentIds" UUID[] DEFAULT ARRAY[]::UUID[];
