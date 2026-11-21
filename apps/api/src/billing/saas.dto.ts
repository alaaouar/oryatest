import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from "class-validator";

export const SUBSCRIPTION_STATUSES = ["trial", "active", "past_due", "suspended", "cancelled"] as const;
export type ManagedStatus = (typeof SUBSCRIPTION_STATUSES)[number];
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePlanDto {
  @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, { message: "Code de plan : minuscules, chiffres et tirets (2 à 40)." })
  code!: string;

  @IsString()
  @Length(2, 80)
  name!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  maxStudents?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  maxStaff?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(366)
  trialDays?: number | null;

  /** Prix en centimes ; null = à définir. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  priceMinor?: number | null;

  @IsOptional() @IsBoolean()
  toBeDefined?: boolean;

  @IsOptional() @IsString() @Length(0, 500)
  notes?: string;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @Length(2, 80)
  name?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  maxStudents?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  maxStaff?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) @Max(366)
  trialDays?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  priceMinor?: number | null;

  @IsOptional() @IsBoolean()
  toBeDefined?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsString() @Length(0, 500)
  notes?: string;
}

export class UpdateSubscriptionDto {
  @IsOptional() @IsString()
  planId?: string;

  @IsOptional() @IsIn(SUBSCRIPTION_STATUSES, { message: "Statut : trial, active, past_due, suspended ou cancelled." })
  status?: ManagedStatus;

  @IsOptional() @Matches(CIVIL_DATE, { message: "Fin d'essai au format AAAA-MM-JJ." })
  trialEndsAt?: string;

  @IsOptional() @Matches(CIVIL_DATE, { message: "Fin de période au format AAAA-MM-JJ." })
  currentPeriodEnd?: string;

  /** Motif obligatoire pour suspendre ou résilier (audit). */
  @IsOptional() @IsString() @Length(3, 300)
  reason?: string;
}

export class DraftInvoiceDto {
  @Matches(CIVIL_DATE, { message: "Début de période au format AAAA-MM-JJ." })
  periodStart!: string;

  @Matches(CIVIL_DATE, { message: "Fin de période au format AAAA-MM-JJ." })
  periodEnd!: string;
}
