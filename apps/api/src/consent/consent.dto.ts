import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from "class-validator";

export class GrantParentalConsentDto {
  @IsUUID()
  textId!: string;

  @IsIn(["student_account", "transport_alerts"])
  purpose!: "student_account" | "transport_alerts";
}

export class PaperParentalConsentDto {
  @IsUUID()
  textId!: string;

  @IsIn(["student_account", "transport_alerts"])
  purpose!: "student_account" | "transport_alerts";

  @IsString()
  @Length(2, 120)
  guardianName!: string;

  @IsISO8601()
  paperDate!: string;

  @IsString()
  @Length(2, 200)
  paperFileReference!: string;
}

export class CreateConsentTextDto {
  @IsIn(["student_account", "transport_alerts"])
  purpose!: "student_account" | "transport_alerts";

  @IsString()
  @Length(1, 32)
  version!: string;

  @IsIn(["fr", "ar"])
  locale!: "fr" | "ar";

  @IsString()
  @Length(20, 20000)
  body!: string;
}

export class ValidateConsentTextDto {
  @IsUUID()
  id!: string;

  /** Reference du document de validation juridique (avis du juriste, n de dossier). */
  @IsString()
  @Length(3, 200)
  @Matches(/^[^=+\-@\t\r]/, { message: "Reference invalide." })
  legalDocumentRef!: string;

  /** Date de la validation juridique (AAAA-MM-JJ), passee ou du jour. */
  @IsISO8601({ strict: true })
  legalValidatedAt!: string;
}
