import { IsIn, IsOptional, IsString, Length, Matches } from "class-validator";

export class StartImportDto {
  /** Nom du fichier, utilisé pour l'affichage et le contrôle d'extension. */
  @IsString()
  @Length(1, 160)
  filename!: string;

  /**
   * Contenu du fichier encodé en base64 (limite dure : 5 Mo décodés).
   * Le multipart sera ajouté plus tard ; le base64 permet un test simple et
   * n'expose pas de fichier temporaire sur le disque.
   */
  @IsString()
  @Length(4, 7_000_000)
  contentBase64!: string;

  @IsString()
  @Matches(/^\d{4}-\d{4}$/, { message: "Année scolaire attendue au format 2026-2027." })
  schoolYear!: string;

  /** Lot 3 : type de fichier importé (élèves par défaut, ou responsables). */
  @IsOptional()
  @IsIn(["students", "guardians"])
  kind?: "students" | "guardians";
}
