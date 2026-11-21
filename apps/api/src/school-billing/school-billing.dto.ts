import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from "class-validator";

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
const YEAR = /^\d{4}-\d{4}$/;
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Bloc 5 : contrat de facturation (super-admin + MFA). Prix en centimes ; TTC calcule. */
export class UpsertContractDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000_000)
  unitPriceHtMinor?: number;

  /** TVA en points de base (2000 = 20 %). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000)
  vatRateBp?: number;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(CIVIL, { message: "trialEndsOn : AAAA-MM-JJ" })
  trialEndsOn?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  paymentTermDays?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365)
  noticeDays?: number;

  @IsOptional() @Matches(MONTH_DAY, { message: "referenceMonthDay : MM-JJ" })
  referenceMonthDay?: string;
}

export class SchoolYearQueryDto {
  @Matches(YEAR, { message: "schoolYear : AAAA-AAAA" })
  schoolYear!: string;

  @IsOptional() @Matches(CIVIL, { message: "referenceDate : AAAA-MM-JJ" })
  referenceDate?: string;
}

export class IssueAnnualDto extends SchoolYearQueryDto {}

export class ComplementaryDto {
  /** Date de comptage des eleves arrives apres la reference de la facture annuelle. */
  @Matches(CIVIL, { message: "countDate : AAAA-MM-JJ" })
  countDate!: string;

  @IsString() @Length(5, 300)
  reason!: string;
}

export class CreditNoteDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100_000)
  quantity!: number;

  @IsString() @Length(5, 300)
  reason!: string;
}

export class PaymentDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000_000)
  amountMinor!: number;

  @Matches(CIVIL, { message: "receivedOn : AAAA-MM-JJ" })
  receivedOn!: string;

  @IsString() @Length(3, 120) @Matches(/^[A-Za-z0-9 ._/-]+$/, { message: "bankReference : lettres, chiffres, espace . _ / -" })
  bankReference!: string;

  @IsOptional() @IsString() @Length(0, 300)
  note?: string;
}

export class EvaluateDto {
  /** Date simulee (hors production uniquement) pour les tests des delais. */
  @IsOptional() @Matches(CIVIL, { message: "asOf : AAAA-MM-JJ" })
  asOf?: string;
}

export class CsvQueryDto {
  @IsOptional() @Matches(CIVIL) from?: string;
  @IsOptional() @Matches(CIVIL) to?: string;
}

/** Direction : dates d'entree / sortie d'un eleve dans l'annee (base du comptage facture). */
export class EnrollmentDatesDto {
  @Matches(YEAR, { message: "schoolYear : AAAA-AAAA" })
  schoolYear!: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(CIVIL, { message: "startsOn : AAAA-MM-JJ" })
  startsOn?: string | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(CIVIL, { message: "endsOn : AAAA-MM-JJ" })
  endsOn?: string | null;
}