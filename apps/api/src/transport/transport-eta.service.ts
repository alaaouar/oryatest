import { Injectable } from "@nestjs/common";

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type StopEtaResult = {
  stopId: string;
  distanceMeters: number;
  etaMinutes: number;
  isWithinRadius: boolean;
};

const EARTH_RADIUS_METERS = 6_371_000;
const ROAD_DETOUR_FACTOR = 1.35; // Facteur moyen pour tenir compte du réseau viaire urbain
const DEFAULT_URBAN_SPEED_KMH = 25; // Vitesse moyenne constatée en zone urbaine marocaine (Casablanca/Rabat)

@Injectable()
export class TransportEtaService {
  /**
   * Calcule la distance orthodromique (Haversine) en mètres entre deux points géographiques.
   */
  haversineDistance(a: Coordinates, b: Coordinates): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);

    const sinDlat2 = Math.sin(dLat / 2);
    const sinDlon2 = Math.sin(dLon / 2);
    const h = sinDlat2 * sinDlat2 + Math.cos(lat1) * Math.cos(lat2) * sinDlon2 * sinDlon2;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return EARTH_RADIUS_METERS * c;
  }

  /**
   * Estime la distance routière et le temps d'arrivée (ETA en minutes).
   */
  computeEta(
    currentLocation: Coordinates,
    stopLocation: Coordinates,
    radiusMeters: number = 50,
    currentSpeedKmh?: number | null,
  ): StopEtaResult {
    const rawDistance = this.haversineDistance(currentLocation, stopLocation);
    const roadDistanceMeters = rawDistance * ROAD_DETOUR_FACTOR;
    const isWithinRadius = rawDistance <= radiusMeters;

    // Si le bus roule à plus de 8 km/h, on utilise sa vitesse réelle lissée, sinon la vitesse urbaine par défaut
    const effectiveSpeedKmh =
      currentSpeedKmh && currentSpeedKmh >= 8 ? Math.min(currentSpeedKmh, 60) : DEFAULT_URBAN_SPEED_KMH;

    const speedMetersPerMinute = (effectiveSpeedKmh * 1000) / 60;
    const etaMinutes = isWithinRadius ? 0 : Math.ceil(roadDistanceMeters / speedMetersPerMinute);

    return {
      stopId: "",
      distanceMeters: Math.round(roadDistanceMeters),
      etaMinutes: Math.max(0, etaMinutes),
      isWithinRadius,
    };
  }

  /**
   * Vérifie si le bus se rapproche et est à environ 5 minutes de l'arrêt (entre 0 et 5 min).
   */
  isApproachingWithin5Min(etaMinutes: number, distanceMeters: number): boolean {
    // 5 minutes ou moins, et à moins de 2.5 km
    return etaMinutes <= 5 && distanceMeters <= 3000;
  }
}
