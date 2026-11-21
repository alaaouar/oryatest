import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class StartTripDto {
  @IsUUID("4", { message: "Identifiant de circuit invalide." })
  circuitId!: string;

  @IsOptional()
  @IsUUID("4", { message: "Identifiant de véhicule invalide." })
  vehicleId?: string;

  @IsEnum(["pickup", "dropoff"], { message: "Direction invalide (pickup ou dropoff)." })
  direction!: "pickup" | "dropoff";

  @IsOptional()
  @IsString()
  notes?: string;
}

export class GpsPointDto {
  @IsNumber({}, { message: "Latitude invalide." })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber({}, { message: "Longitude invalide." })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @IsOptional()
  @IsString()
  recordedAt?: string;
}

export class IngestPositionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GpsPointDto)
  positions!: GpsPointDto[];
}

export class RecordStopEventDto {
  @IsUUID("4", { message: "Identifiant d'arrêt invalide." })
  stopId!: string;

  @IsIn(["arrived", "departed", "students_dropped"], { message: "Type d'événement d'arrêt invalide." })
  eventType!: "arrived" | "departed" | "students_dropped";
}

export class CreateVehicleDto {
  @IsString({ message: "Le numéro d'immatriculation est requis." })
  plateNumber!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class UpdateStopCoordinatesDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(500)
  radiusMeters?: number;
}

export class ToggleTransportTrackingDto {
  enabled!: boolean;
}

export class ShareParentLocationDto {
  @IsNumber({}, { message: "Latitude invalide." })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber({}, { message: "Longitude invalide." })
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsString({ message: "L'adresse doit être une chaîne de caractères." })
  address?: string;

  @IsOptional()
  @IsBoolean()
  relocateDemoSchool?: boolean;
}
