import { IsEmail, MaxLength } from "class-validator";

export class InviteStudentDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}