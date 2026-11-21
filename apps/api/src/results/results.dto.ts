import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NO_FORMULA = /^[^=+\-@\t\r]/;

export class CreateAssessmentDto {
  @IsUUID()
  classroomId!: string;

  @IsString()
  @Length(2, 80, { message: "Matière de 2 à 80 caractères." })
  @Matches(NO_FORMULA, { message: "La matière ne peut pas commencer par un caractère de formule." })
  subject!: string;

  @IsString()
  @Length(2, 120, { message: "Intitulé de 2 à 120 caractères." })
  @Matches(NO_FORMULA, { message: "L'intitulé ne peut pas commencer par un caractère de formule." })
  title!: string;

  @Matches(CIVIL_DATE, { message: "Date attendue au format AAAA-MM-JJ." })
  date!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxScore?: number;
}

export class ScoreDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  score?: number | null;

  @IsOptional()
  @IsBoolean()
  absent?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  @Matches(/^$|^[^=+\-@\t\r]/, { message: "Le commentaire ne peut pas commencer par un caractère de formule." })
  comment?: string;
}

export class SetScoresDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ScoreDto)
  scores!: ScoreDto[];
}

export class ListAssessmentsQueryDto {
  @IsOptional()
  @IsUUID()
  classroomId?: string;
}
