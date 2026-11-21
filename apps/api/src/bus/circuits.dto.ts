import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf, ValidateNested } from "class-validator";

const NO_FORMULA = /^[^=+\-@\t\r]/;

export class CreateCircuitDto {
  @IsString()
  @Length(2, 80, { message: "Nom du circuit de 2 à 80 caractères." })
  @Matches(NO_FORMULA, { message: "Le nom ne peut pas commencer par un caractère de formule." })
  name!: string;

  @IsOptional()
  @IsUUID()
  attendantProfileId?: string;
}

export class UpdateCircuitDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Matches(NO_FORMULA)
  name?: string;

  /** null : retire l'accompagnateur. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  attendantProfileId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateStopDto {
  @IsString()
  @Length(2, 120, { message: "Nom de l'arrêt de 2 à 120 caractères." })
  @Matches(NO_FORMULA, { message: "Le nom ne peut pas commencer par un caractère de formule." })
  name!: string;
}

export class CircuitMemberDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsUUID()
  stopId?: string;
}

export class SetCircuitStudentsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CircuitMemberDto)
  students!: CircuitMemberDto[];
}

export class RoadmapQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}
