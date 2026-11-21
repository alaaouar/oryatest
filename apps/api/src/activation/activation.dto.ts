import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

export class ActivateParentDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{6}$/, { message: "Le code établissement contient 6 caractères." })
  schoolCode!: string;

  /**
   * Code d'activation remis par l'école : long, aléatoire et expirant.
   * Les tirets et espaces sont ignorés à la saisie.
   */
  @IsString()
  @Length(16, 64, { message: "Le code d'activation est invalide." })
  activationCode!: string;

  @IsEmail({}, { message: "Adresse e-mail invalide." })
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsOptional()
  @IsString()
  @Length(2, 40)
  relationship?: string;
}

export class AcceptInvitationDto {
  @IsString()
  @Length(10, 400)
  token!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @IsOptional()
  @IsIn(["fr", "ar"])
  locale?: "fr" | "ar";
}

export class CreateInvitationDto {
  @IsIn(["teacher", "bus_attendant", "chauffeur"], { message: "Rôle d'invitation non autorisé." })
  role!: "teacher" | "bus_attendant" | "chauffeur";

  @IsEmail({}, { message: "Adresse e-mail invalide." })
  email!: string;
}

export class CreateSchoolDto {
  @IsString()
  @Length(2, 120, { message: "Le nom de l'école doit comporter entre 2 et 120 caractères." })
  name!: string;

  @IsString()
  @Length(2, 80, { message: "La ville doit comporter entre 2 et 80 caractères." })
  city!: string;

  @IsOptional()
  @IsString()
  @Length(3, 40)
  ice?: string;

  @IsOptional()
  @IsIn(["pending", "active"])
  status?: "pending" | "active";

  @IsOptional()
  @IsEmail({}, { message: "Adresse e-mail de l'administrateur invalide." })
  adminEmail?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120, { message: "Le nom de l'administrateur doit comporter entre 2 et 120 caractères." })
  adminName?: string;

  @IsOptional()
  @IsString()
  @Length(8, 128, { message: "Le mot de passe doit comporter au moins 8 caractères." })
  adminPassword?: string;
}

export class CreateSchoolAdminDto {
  @IsEmail({}, { message: "Adresse e-mail invalide." })
  email!: string;

  @IsString()
  @Length(2, 120, { message: "Le nom de l'administrateur doit comporter entre 2 et 120 caractères." })
  displayName!: string;

  @IsOptional()
  @IsString()
  @Length(8, 128, { message: "Le mot de passe doit comporter au moins 8 caractères." })
  password?: string;
}

export class IssueActivationCodeDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}$/, { message: "Durée de validité invalide (en jours)." })
  ttlDays?: string;
}
