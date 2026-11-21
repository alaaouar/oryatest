import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Length, Matches, Max, Min } from "class-validator";

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const NO_FORMULA = /^[^=+\-@\t\r]/;

export class WorkingDaysDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Au moins un jour ouvré." })
  @ArrayMaxSize(14)
  @IsInt({ each: true })
  @Min(1, { each: true, message: "Jour attendu de 1 (lundi) à 7 (dimanche)." })
  @Max(7, { each: true, message: "Jour attendu de 1 (lundi) à 7 (dimanche)." })
  workingDays!: number[];
}

export class HolidayDto {
  @IsString()
  @Length(2, 120, { message: "Libellé de 2 à 120 caractères." })
  @Matches(NO_FORMULA, { message: "Le libellé ne peut pas commencer par un caractère de formule." })
  label!: string;

  @Matches(CIVIL_DATE, { message: "Date de début attendue au format AAAA-MM-JJ." })
  startDate!: string;

  @Matches(CIVIL_DATE, { message: "Date de fin attendue au format AAAA-MM-JJ." })
  endDate!: string;
}

export class DayQueryDto {
  @Matches(CIVIL_DATE, { message: "Date attendue au format AAAA-MM-JJ." })
  date!: string;
}
