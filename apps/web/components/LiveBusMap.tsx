"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { getApiBase } from "@/lib/api";
import { LeafletMapAdapter, type LatLng } from "@/lib/map-adapter";
import "leaflet/dist/leaflet.css";

interface LiveBusMapProps {
  schoolLocation?: { name: string; latitude: number; longitude: number } | null;
  assignedStop?: {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
    address: string | null;
  } | null;
  trip?: {
    id: string;
    direction: "pickup" | "dropoff";
    status: string;
    latestPosition?: {
      latitude: number;
      longitude: number;
      speed?: number | null;
      heading?: number | null;
      recordedAt?: string;
    } | null;
    etaMinutes?: number | null;
    distanceMeters?: number | null;
  } | null;
  studentName?: string;
}

export function LiveBusMap({
  schoolLocation,
  assignedStop,
  trip,
  studentName,
}: LiveBusMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<LeafletMapAdapter | null>(null);

  const [livePos, setLivePos] = useState(trip?.latestPosition ?? null);
  const [eta, setEta] = useState<number | null>(trip?.etaMinutes ?? null);
  const [distance, setDistance] = useState<number | null>(trip?.distanceMeters ?? null);
  const [status, setStatus] = useState<string>(trip?.status ?? "planned");
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Initialisation de la carte
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isMounted = true;

    const adapter = new LeafletMapAdapter();
    adapterRef.current = adapter;

    const defaultCenter: LatLng = schoolLocation
      ? [schoolLocation.latitude, schoolLocation.longitude]
      : [33.5898, -7.6038];

    adapter.init(mapContainerRef.current, { center: defaultCenter, zoom: 14 }).then(() => {
      if (!isMounted) {
        adapter.destroy();
        return;
      }
      // 1. Marqueur École
      if (schoolLocation) {
        adapter.setSchoolMarker(
          schoolLocation.latitude,
          schoolLocation.longitude,
          schoolLocation.name || "École",
        );
      }

      // 2. Marqueur Arrêt de l'enfant
      if (assignedStop?.latitude && assignedStop?.longitude) {
        adapter.setStopMarker(
          assignedStop.latitude,
          assignedStop.longitude,
          assignedStop.name,
          true,
        );
      }

      // 3. Marqueur initial Bus
      if (livePos) {
        adapter.updateBusPosition(
          livePos.latitude,
          livePos.longitude,
          livePos.heading,
          livePos.speed,
        );
      }

      // 4. Tracé indicatif
      const points: LatLng[] = [];
      if (schoolLocation) points.push([schoolLocation.latitude, schoolLocation.longitude]);
      if (livePos) points.push([livePos.latitude, livePos.longitude]);
      if (assignedStop?.latitude && assignedStop?.longitude) {
        points.push([assignedStop.latitude, assignedStop.longitude]);
      }
      if (points.length >= 2) {
        adapter.setRoutePath(points);
        adapter.fitBounds();
      }
    });

    return () => {
      isMounted = false;
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [schoolLocation, assignedStop]);

  // Connexion au flux SSE du trajet en direct
  useEffect(() => {
    if (!trip?.id || trip.status !== "in_progress") {
      setConnected(false);
      return;
    }

    const apiBase = getApiBase();
    const sseUrl = `${apiBase}/transport/trips/${trip.id}/live`;

    const eventSource = new EventSource(sseUrl, { withCredentials: true });

    eventSource.onopen = () => {
      setConnected(true);
    };

    eventSource.addEventListener("transport_update", (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === "position") {
          const lat = payload.latitude;
          const lng = payload.longitude;
          const heading = payload.heading;
          const speed = payload.speed;

          if (lat != null && lng != null) {
            setLivePos({
              latitude: lat,
              longitude: lng,
              heading,
              speed,
              recordedAt: payload.recordedAt,
            });

            if (adapterRef.current) {
              adapterRef.current.updateBusPosition(lat, lng, heading, speed);
            }

            // Mise à jour de l'ETA pour l'arrêt de l'enfant si fourni
            if (assignedStop?.id && payload.etaByStop?.[assignedStop.id]) {
              const stopEta = payload.etaByStop[assignedStop.id];
              setEta(stopEta.etaMinutes);
              setDistance(stopEta.distanceMeters);
            }
          }
        } else if (payload.type === "stop_event") {
          setLastEvent(payload.eventType === "arrived" ? "Le bus est arrivé à l'arrêt" : "Élèves déposés");
        } else if (payload.type === "trip_status") {
          setStatus(payload.status);
          if (payload.status === "completed") {
            setConnected(false);
          }
        }
      } catch (err) {
        console.error("Erreur parsing SSE transport:", err);
      }
    });

    eventSource.onerror = () => {
      setConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [trip?.id, trip?.status, assignedStop?.id]);

  const isCompleted = status === "completed";
  const isInProgress = status === "in_progress";

  return (
    <div className="live-bus-map">
      {/* Barre de statut supérieure */}
      <div className="live-bus-map__header">
        <div className="live-bus-map__heading">
          <Image src="/bus.svg" alt="" aria-hidden width={22} height={22} className="svg-icon" />
          <div>
            <div className="live-bus-map__title">
              {trip?.direction === "pickup" ? "Tournée du Matin (Ramassage)" : "Tournée du Soir (Dépose)"}
            </div>
            {studentName ? (
              <div className="live-bus-map__student">
                Élève : <strong>{studentName}</strong>
              </div>
            ) : null}
          </div>
        </div>

        <div className="live-bus-map__status-list">
          {isInProgress ? (
            <span className="live-bus-map__status" data-status="active">
              <span className="live-bus-map__status-dot" />
              En route {connected ? "(Direct)" : ""}
            </span>
          ) : isCompleted ? (
            <span className="live-bus-map__status" data-status="complete">
              ✓ Tournée terminée
            </span>
          ) : (
            <span className="live-bus-map__status" data-status="pending">
              En attente de départ
            </span>
          )}

          {eta != null && isInProgress ? (
            <span className="live-bus-map__eta" data-tone={eta <= 5 ? "near" : "normal"}>
              {eta === 0 ? "Arrivé à l'arrêt" : `~${eta} min (${distance ? `${Math.round(distance / 100) / 10} km` : ""})`}
            </span>
          ) : null}
        </div>
      </div>

      {/* Conteneur Cartographique */}
      <div
        ref={mapContainerRef}
        className="live-bus-map__canvas"
      />

      {/* Bandeau d'information inférieur */}
      <div className="live-bus-map__footer">
        <div>
          <span className="live-bus-map__muted">Arrêt assigné : </span>
          <strong>{assignedStop?.name ?? "Non assigné"}</strong>
          {assignedStop?.address ? (
            <span className="live-bus-map__address">({assignedStop.address})</span>
          ) : null}
        </div>

        {lastEvent ? (
          <div className="live-bus-map__event">{lastEvent}</div>
        ) : null}

        <div className="live-bus-map__privacy">
          Loi 09-08 CNDP : géolocalisation active uniquement pendant la tournée
        </div>
      </div>
    </div>
  );
}
