import { IsIn, IsOptional, IsUUID, Matches } from "class-validator";

export const BUS_STATUSES = ["not_planned", "waiting", "on_board", "dropped_off", "absent"] as const;

/** Statut seulement : tout champ de position (lat, lng, map...) est refuse (400, forbidNonWhitelisted). */
export class SetBusStatusDto {
  @IsUUID()
  studentId!: string;

  @IsIn(BUS_STATUSES)
  status!: (typeof BUS_STATUSES)[number];

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}

export class BusDateQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;
}