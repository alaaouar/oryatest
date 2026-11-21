import { IsOptional, IsString, IsUUID, Length, MinLength } from "class-validator";

export class RequestDeletionDto {
  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(6, 8)
  mfaCode?: string;
}

export class RequestStudentDeletionDto extends RequestDeletionDto {
  @IsUUID()
  studentId!: string;
}
