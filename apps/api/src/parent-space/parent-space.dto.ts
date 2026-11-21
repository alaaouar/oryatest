import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";

const NO_FORMULA = /^[^=+\-@\t\r]/;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class SubmitJustificationDto {
  @IsUUID()
  studentId!: string;

  @Matches(CIVIL_DATE, { message: "Date de début attendue au format AAAA-MM-JJ." })
  fromDate!: string;

  @Matches(CIVIL_DATE, { message: "Date de fin attendue au format AAAA-MM-JJ." })
  toDate!: string;

  @IsString()
  @Length(3, 1000, { message: "Le motif contient entre 3 et 1000 caractères." })
  @Matches(NO_FORMULA, { message: "Le motif ne peut pas commencer par un caractère de formule." })
  reason!: string;

  // Bloc 3b : plus de champ "file" en base64 ; la piece arrive en multipart (multer).
}

/** t92 M4 : complément apporté par la famille à un justificatif « à compléter » (motif et/ou pièce). */
export class CompleteJustificationDto {
  @IsOptional()
  @IsString()
  @Length(3, 1000, { message: "Le motif contient entre 3 et 1000 caractères." })
  @Matches(NO_FORMULA, { message: "Le motif ne peut pas commencer par un caractère de formule." })
  reason?: string;
}

export class ReviewJustificationDto {
  @IsIn(["accepted", "rejected", "incomplete"], { message: "Décision attendue : accepted, rejected ou incomplete." })
  decision!: "accepted" | "rejected" | "incomplete";

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class ListJustificationsQueryDto {
  @IsOptional()
  @IsIn(["pending", "accepted", "rejected", "incomplete"])
  status?: "pending" | "accepted" | "rejected" | "incomplete";
}

export class CreateParentActionDto {
  @IsUUID()
  studentId!: string;

  @IsString()
  @Length(3, 160)
  @Matches(NO_FORMULA, { message: "Le titre ne peut pas commencer par un caractère de formule." })
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @Matches(CIVIL_DATE, { message: "Échéance attendue au format AAAA-MM-JJ." })
  dueDate?: string;
}

export class ListParentActionsQueryDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsIn(["open", "done", "cancelled"])
  status?: "open" | "done" | "cancelled";
}
