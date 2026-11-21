import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from "class-validator";

export class LoginDto {
  @IsEmail({}, { message: "Adresse e-mail invalide." })
  email!: string;

  @IsString()
  @Length(8, 128, { message: "Le mot de passe doit contenir entre 8 et 128 caractères." })
  password!: string;

  @IsOptional()
  @IsIn(["android", "ios", "web"])
  platform?: "android" | "ios" | "web";
}

export class RefreshDto {
  /** Absent pour le client web : le jeton vient alors du cookie httpOnly (lot 10). */
  @IsOptional()
  @IsString()
  @Length(20, 512)
  refreshToken?: string;
}

export class MfaChallengeDto {
  @IsString()
  @Length(20, 2048)
  challengeToken!: string;
}

export class MfaVerifyDto {
  @IsString()
  @Length(20, 2048)
  challengeToken!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: "Le code doit contenir 6 chiffres." })
  code!: string;
}

export class SelectProfileDto {
  @IsUUID("4", { message: "Identifiant de profil invalide." })
  profileId!: string;
}

/** t62u A1 : changement de mot de passe (session authentifiee, mot de passe actuel exige). */
export class ChangePasswordDto {
  @IsString()
  @Length(8, 128, { message: "Mot de passe actuel invalide." })
  currentPassword!: string;

  /** Politique complete appliquee par le service (password-policy.ts) ; ici bornes seulement. */
  @IsString()
  @Length(1, 128, { message: "Le nouveau mot de passe doit contenir au plus 128 caracteres." })
  newPassword!: string;
}

/** F01 (t87u) : demande de reinitialisation (reponse identique que le compte existe ou non). */
export class PasswordForgotDto {
  @IsEmail({}, { message: "Adresse e-mail invalide." })
  @Length(3, 254)
  email!: string;
}

/** F01 (t87u) : nouveau mot de passe ; politique complete appliquee par le service. */
export class PasswordResetDto {
  @IsString()
  @Length(20, 200, { message: "Lien de reinitialisation invalide." })
  token!: string;

  @IsString()
  @Length(1, 128, { message: "Le nouveau mot de passe doit contenir au plus 128 caracteres." })
  newPassword!: string;
}
