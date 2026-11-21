import { IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from "class-validator";

export class ListStudentsQueryDto {
  @IsOptional()
  @IsString()
  @Length(0, 80)
  search?: string;

  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{4}$/, { message: "Année scolaire attendue au format 2026-2027." })
  schoolYear?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  unassigned?: string;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Matches(/^[^=+\-@\t\r]/, { message: "Le nom ne peut pas commencer par un caractère de formule." })
  displayName?: string;

  /** AAAA-MM-JJ, ou chaîne vide pour effacer. */
  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "Date attendue au format AAAA-MM-JJ." })
  birthDate?: string;

  /** Code Massar : lettre + chiffres ; chaîne vide pour effacer (tracé). */
  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @Matches(/^[A-Za-z][0-9A-Za-z]{5,19}$/, { message: "Code Massar invalide (ex. : J130000000)." })
  massarCode?: string;
}

export class ChangeClassDto {
  @IsUUID()
  classroomId!: string;

  @Matches(/^\d{4}-\d{4}$/, { message: "Année scolaire attendue au format 2026-2027." })
  schoolYear!: string;
}
