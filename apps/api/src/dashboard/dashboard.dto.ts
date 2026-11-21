import { IsIn, IsOptional, Matches } from "class-validator";

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DashboardRangeDto {
  @IsOptional()
  @Matches(CIVIL_DATE, { message: "Date de début attendue au format AAAA-MM-JJ." })
  from?: string;

  @IsOptional()
  @Matches(CIVIL_DATE, { message: "Date de fin attendue au format AAAA-MM-JJ." })
  to?: string;
}

export const REPORTS = ["classes", "today", "teachers", "unjustified", "activity", "communications"] as const;
export type ReportName = (typeof REPORTS)[number];

export class DashboardExportDto extends DashboardRangeDto {
  @IsIn(REPORTS, { message: "Rapport inconnu." })
  report!: ReportName;

  @IsIn(["csv", "xlsx"], { message: "Format attendu : csv ou xlsx." })
  format!: "csv" | "xlsx";
}
