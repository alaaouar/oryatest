import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
  UseGuards,
  type MessageEvent,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { CurrentAuth, Roles } from "../auth/decorators";
import { JwtAuthGuard, MfaGuard, RolesGuard } from "../auth/guards";
import type { AuthContext } from "../auth/auth.types";
import { TransportService } from "./transport.service";
import { TransportRealtimeService } from "./transport-realtime.service";
import {
  CreateVehicleDto,
  IngestPositionsDto,
  RecordStopEventDto,
  ShareParentLocationDto,
  StartTripDto,
  ToggleTransportTrackingDto,
  UpdateStopCoordinatesDto,
} from "./transport.dto";

@Controller("transport")
@UseGuards(JwtAuthGuard, RolesGuard, MfaGuard)
export class TransportController {
  constructor(
    private readonly transport: TransportService,
    private readonly realtime: TransportRealtimeService,
  ) {}

  /**
   * Notice d'information légale Loi 09-08 / CNDP.
   */
  @Get("notice")
  @Roles("parent", "chauffeur", "bus_attendant", "direction", "super_admin")
  notice() {
    return this.transport.getLegalNotice();
  }

  // =========================================================================
  // ESPACE CHAUFFEUR
  // =========================================================================

  @Get("driver/session")
  @Roles("chauffeur", "bus_attendant", "direction")
  driverSession(@CurrentAuth() auth: AuthContext) {
    return this.transport.getDriverSession(auth);
  }

  @Post("trips/start")
  @Roles("chauffeur", "bus_attendant", "direction")
  @HttpCode(201)
  startTrip(@CurrentAuth() auth: AuthContext, @Body() dto: StartTripDto) {
    return this.transport.startTrip(auth, dto);
  }

  @Post("trips/:id/positions")
  @Roles("chauffeur", "bus_attendant", "direction")
  @HttpCode(200)
  ingestPositions(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) tripId: string,
    @Body() dto: IngestPositionsDto,
  ) {
    return this.transport.recordPositions(auth, tripId, dto);
  }

  @Post("trips/:id/stop-event")
  @Roles("chauffeur", "bus_attendant", "direction")
  @HttpCode(200)
  recordStopEvent(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) tripId: string,
    @Body() dto: RecordStopEventDto,
  ) {
    return this.transport.recordStopEvent(auth, tripId, dto);
  }

  @Post("trips/:id/end")
  @Roles("chauffeur", "bus_attendant", "direction")
  @HttpCode(200)
  endTrip(@CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) tripId: string) {
    return this.transport.endTrip(auth, tripId);
  }

  // =========================================================================
  // ESPACE PARENT
  // =========================================================================

  @Get("parent/child/:studentId")
  @Roles("parent", "direction", "super_admin")
  parentChildTrip(
    @CurrentAuth() auth: AuthContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
  ) {
    return this.transport.getParentChildTrip(auth, studentId);
  }

  @Post("parent/child/:studentId/share-location")
  @Roles("parent", "direction", "super_admin")
  @HttpCode(200)
  shareHomeLocation(
    @CurrentAuth() auth: AuthContext,
    @Param("studentId", ParseUUIDPipe) studentId: string,
    @Body() dto: ShareParentLocationDto,
  ) {
    return this.transport.shareHomeLocation(auth, studentId, dto);
  }

  // =========================================================================
  // TEMPS RÉEL (SSE) — AUTORISATION STRICTE
  // =========================================================================

  @Sse("trips/:id/live")
  @Roles("parent", "chauffeur", "bus_attendant", "direction", "super_admin")
  async tripLive(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) tripId: string,
  ): Promise<Observable<MessageEvent>> {
    // Vérification des droits d'accès
    const initialPayload = await this.transport.assertCanSubscribeTrip(auth, tripId);
    return this.realtime.getTripStream(tripId, initialPayload);
  }

  // =========================================================================
  // ESPACE DIRECTION & ADMINISTRATION
  // =========================================================================

  @Get("admin/fleet")
  @Roles("direction", "super_admin")
  fleetOverview(@CurrentAuth() auth: AuthContext) {
    return this.transport.getFleetOverview(auth);
  }

  @Post("admin/stops/:id/location")
  @Roles("direction", "super_admin")
  updateStopCoordinates(
    @CurrentAuth() auth: AuthContext,
    @Param("id", ParseUUIDPipe) stopId: string,
    @Body() dto: UpdateStopCoordinatesDto,
  ) {
    return this.transport.updateStopCoordinates(auth, stopId, dto);
  }

  @Post("admin/vehicles")
  @Roles("direction", "super_admin")
  @HttpCode(201)
  createVehicle(@CurrentAuth() auth: AuthContext, @Body() dto: CreateVehicleDto) {
    return this.transport.createVehicle(auth, dto);
  }

  @Post("admin/toggle")
  @Roles("direction", "super_admin")
  @HttpCode(200)
  toggleTracking(@CurrentAuth() auth: AuthContext, @Body() dto: ToggleTransportTrackingDto) {
    return this.transport.toggleTracking(auth, dto.enabled);
  }
}
