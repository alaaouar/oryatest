import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from "class-validator";

/** Aucune valeur ne peut commencer par un caractère de formule (export tableur). */
const NO_FORMULA = /^[^=+\-@\t\r]/;
/** Téléphone : chiffres, espaces, +, points, tirets ; 8 à 20 caractères. */
const PHONE = /^\+?[0-9][0-9 .\-]{7,19}$/;

export class GuardianInputDto {
  @IsString()
  @Length(2, 120)
  @Matches(NO_FORMULA, { message: "Le nom ne peut pas commencer par un caractère de formule." })
  fullName!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @IsEmail({}, { message: "Adresse e-mail invalide." })
  email?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @Matches(PHONE, { message: "Numéro de téléphone invalide." })
  phone?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @Matches(PHONE, { message: "Numéro de téléphone secondaire invalide." })
  phoneSecondary?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @IsString()
  @Length(2, 300)
  @Matches(NO_FORMULA, { message: "L'adresse ne peut pas commencer par un caractère de formule." })
  address?: string;
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Matches(NO_FORMULA, { message: "Le nom ne peut pas commencer par un caractère de formule." })
  fullName?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @IsEmail({}, { message: "Adresse e-mail invalide." })
  email?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @Matches(PHONE, { message: "Numéro de téléphone invalide." })
  phone?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @Matches(PHONE, { message: "Numéro de téléphone secondaire invalide." })
  phoneSecondary?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== "")
  @IsString()
  @Length(2, 300)
  @Matches(NO_FORMULA, { message: "L'adresse ne peut pas commencer par un caractère de formule." })
  address?: string;
}

export class LinkStudentDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsString()
  @Length(2, 40)
  @Matches(NO_FORMULA, { message: "Lien de parenté invalide." })
  relationship?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class ListGuardiansQueryDto {
  @IsOptional()
  @IsString()
  @Length(0, 80)
  search?: string;
}
