import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from "class-validator";

const NO_FORMULA = /^[^=+\-@\t\r]/;

export class SendMessageDto {
  @IsIn(["announcement", "event", "class_message", "direct"])
  kind!: "announcement" | "event" | "class_message" | "direct";

  @IsIn(["school", "classroom", "student", "level", "selection"])
  audience!: "school" | "classroom" | "student" | "level" | "selection";

  /** t92 M5 : niveau visé (audience = level), tel que saisi sur les classes ("6e", "Tronc commun"…). */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  level?: string;

  /** t92 M5 : élèves visés (audience = selection). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: "Sélectionnez au moins un élève." })
  @ArrayMaxSize(200, { message: "200 élèves au plus par sélection." })
  @IsUUID("all", { each: true })
  studentIds?: string[];

  @IsOptional()
  @IsUUID()
  classroomId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsString()
  @Length(3, 160)
  @Matches(NO_FORMULA, { message: "Le titre ne peut pas commencer par un caractère de formule." })
  title!: string;

  @IsString()
  @Length(1, 5000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  important?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;

  @IsOptional()
  @IsISO8601()
  eventAt?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  eventLocation?: string;

  /** Canaux supplémentaires souhaités ; l'in-app est toujours utilisé. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @IsIn(["email"], { each: true })
  channels?: "email"[];
}

export class ReplyDto {
  @IsString()
  @Length(1, 2000)
  body!: string;
}

export class ListFamilyMessagesQueryDto {
  @IsOptional()
  @IsIn(["announcement", "event", "class_message", "direct"])
  kind?: "announcement" | "event" | "class_message" | "direct";
}
