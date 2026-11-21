import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";

const NO_FORMULA = /^[^=+\-@\t\r]/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const AGENDA_KINDS = ["homework", "test", "class_event", "important_date"] as const;
export type AgendaKindValue = (typeof AGENDA_KINDS)[number];

export class CreateAgendaItemDto {
  @IsIn(AGENDA_KINDS)
  kind!: AgendaKindValue;

  /** Absent = date importante pour toute l'école (direction uniquement). */
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @IsString()
  @Length(3, 160)
  @Matches(NO_FORMULA, { message: "Le titre ne peut pas commencer par un caractère de formule." })
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  /** Échéance (devoir) ou date de l'entrée. */
  @Matches(CIVIL_DATE, { message: "Date attendue au format AAAA-MM-JJ." })
  date!: string;

  // Bloc 3b : pieces jointes en multipart (champ "attachments", 3 maximum), plus de base64.
}

export class UpdateAgendaItemDto {
  @IsOptional()
  @IsString()
  @Length(3, 160)
  @Matches(NO_FORMULA, { message: "Le titre ne peut pas commencer par un caractère de formule." })
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @Matches(CIVIL_DATE, { message: "Date attendue au format AAAA-MM-JJ." })
  date?: string;
}

export class AgendaRangeQueryDto {
  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @IsOptional()
  @Matches(CIVIL_DATE)
  from?: string;

  @IsOptional()
  @Matches(CIVIL_DATE)
  to?: string;

  @IsOptional()
  @IsIn(AGENDA_KINDS)
  kind?: AgendaKindValue;
}
