import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateAssignmentDto {
  @IsUUID()
  teacherProfileId!: string;

  @IsUUID()
  classroomId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{4}$/, { message: "Année scolaire attendue au format 2026-2027." })
  schoolYear!: string;
}

export class OpenSessionDto {
  @IsUUID()
  classroomId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Date attendue au format AAAA-MM-JJ." })
  date!: string;

  @IsIn(["morning", "afternoon"])
  slot!: "morning" | "afternoon";
}

export class AttendanceMarkDto {
  @IsUUID()
  studentId!: string;

  @IsIn(["present", "absent", "late"])
  status!: "present" | "absent" | "late";

  /** Réservé Lot hors ligne — accepté et stocké, non requis. */
  @IsOptional()
  @IsUUID()
  clientMutationId?: string;
}

export class BulkAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AttendanceMarkDto)
  rows!: AttendanceMarkDto[];
}

export class ReopenSessionDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}

export class SchoolYearQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{4}$/, { message: "Année scolaire attendue au format 2026-2027." })
  schoolYear?: string;
}

export class FindSessionsQueryDto {
  @IsUUID()
  classroomId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Date attendue au format AAAA-MM-JJ." })
  date!: string;

  @IsOptional()
  @IsIn(["morning", "afternoon"])
  slot?: "morning" | "afternoon";
}

/** F03 / B11 (ADR-003) : mutation d'appel saisie hors ligne, rejouable sans effet double. */
export class AttendanceSyncMutationDto {
  @IsUUID()
  clientMutationId!: string;

  @IsUUID()
  studentId!: string;

  @IsIn(["present", "absent", "late"])
  status!: "present" | "absent" | "late";

  /** Heure de saisie sur l'appareil (ISO 8601) ; bornee a l'heure serveur. */
  @IsISO8601({ strict: true })
  recordedAt!: string;
}

export class SyncAttendanceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AttendanceSyncMutationDto)
  mutations!: AttendanceSyncMutationDto[];
}