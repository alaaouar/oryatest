import { IsIn, IsOptional, Matches } from "class-validator";

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SCHOOL_YEAR = /^\d{4}-\d{4}$/;

export const MASSAR_REPORTS = ["students", "enrollments", "absences", "absence-totals", "anomalies"] as const;
export type MassarReport = (typeof MASSAR_REPORTS)[number];

export class MassarCheckDto {
  @IsOptional()
  @Matches(SCHOOL_YEAR, { message: "Année scolaire attendue au format AAAA-AAAA." })
  schoolYear?: string;
}

export class MassarExportDto extends MassarCheckDto {
  @IsIn(MASSAR_REPORTS, { message: "Rapport inconnu." })
  report!: MassarReport;

  @IsIn(["csv", "xlsx"], { message: "Format attendu : csv ou xlsx." })
  format!: "csv" | "xlsx";

  @IsOptional()
  @Matches(CIVIL_DATE, { message: "Date de début attendue au format AAAA-MM-JJ." })
  from?: string;

  @IsOptional()
  @Matches(CIVIL_DATE, { message: "Date de fin attendue au format AAAA-MM-JJ." })
  to?: string;
}
