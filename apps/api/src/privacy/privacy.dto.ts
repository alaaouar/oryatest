import { IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateDataRightsDto {
  @IsIn(["rectification", "opposition"])
  kind!: "rectification" | "opposition";

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  message!: string;
}

export class CloseDataRightsDto {
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  response!: string;
}

export class DataRightsQueryDto {
  @IsOptional()
  @IsIn(["open", "closed"])
  status?: "open" | "closed";
}