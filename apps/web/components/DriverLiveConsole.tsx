"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  describeError,
  endTrip,
  getDriverSession,
  ingestTripPositions,
  recordTripStopEvent,
  startTrip,
  type DriverSessionView,
} from "@/lib/api";

type StoredGpsPoint = {
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  recordedAt: string;
};

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (event: string, callback: () => void) => void;
};

const QUEUE_STORAGE_KEY = "orya.driver.gps_queue.v1";

export function DriverLiveConsole() {
  const [session, setSession] = useState<DriverSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Formulaire de démarrage
  const [selectedCircuit, setSelectedCircuit] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [direction, setDirection] = useState<"pickup" | "dropoff">("dropoff");

  // Télémétrie en direct
  const [isTracking, setIsTracking] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [currentGps, setCurrentGps] = useState<{
    lat: number;
    lng: number;
    speed: number | null;
    heading: number | null;
    accuracy: number | null;
  } | null>(null);
  const [pointsSentCount, setPointsSentCount] = useState(0);
  const [queuedPointsCount, setQueuedPointsCount] = useState(0);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const lastEmitTimeRef = useRef<number>(0);
  const activeTripIdRef = useRef<string | null>(null);

  // Chargement de la session chauffeur
  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getDriverSession();
      setSession(data);
      if (data.activeTrip) {
        activeTripIdRef.current = data.activeTrip.id;
        setIsTracking(true);
      } else {
        activeTripIdRef.current = null;
        setIsTracking(false);
      }
      if (data.circuits.length > 0 && !selectedCircuit) {
        setSelectedCircuit(data.circuits[0].id);
      }
      if (data.vehicles.length > 0 && !selectedVehicle) {
        setSelectedVehicle(data.vehicles[0].id);
      }
    } catch (e: unknown) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [selectedCircuit, selectedVehicle]);

  useEffect(() => {
    load();
  }, [load]);

  // Gestion du Screen Wake Lock API (maintien de l'écran allumé sur le support tableau de bord)
  const requestWakeLock = useCallback(async () => {
    if (typeof window === "undefined" || !("wakeLock" in navigator)) return;
    try {
      const lock = await (navigator as unknown as { wakeLock: { request: (type: string) => Promise<WakeLockSentinelLike> } }).wakeLock.request("screen");
      wakeLockRef.current = lock;
      setWakeLockActive(true);
      lock.addEventListener("release", () => {
        setWakeLockActive(false);
      });
    } catch (err) {
      console.warn("Screen Wake Lock indisponible ou refusé:", err);
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try {
        void wakeLockRef.current.release();
      } catch (_) {}
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  }, []);

  // Vidage de la file d'attente hors-ligne
  const flushQueue = useCallback(async (tripId: string) => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return;

    try {
      const queue: StoredGpsPoint[] = JSON.parse(raw);
      if (!Array.isArray(queue) || queue.length === 0) return;

      // Élimination des points obsolètes (> 10 minutes)
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      const validPoints = queue.filter((p) => new Date(p.recordedAt).getTime() > tenMinutesAgo);

      if (validPoints.length > 0) {
        await ingestTripPositions(tripId, validPoints);
        setPointsSentCount((c) => c + validPoints.length);
      }

      localStorage.removeItem(QUEUE_STORAGE_KEY);
      setQueuedPointsCount(0);
    } catch (err) {
      console.error("Erreur vidage file GPS hors-ligne:", err);
    }
  }, []);

  // Déclenchement et throttling adaptatif de la géolocalisation
  useEffect(() => {
    if (!isTracking || !activeTripIdRef.current) {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      releaseWakeLock();
      return;
    }

    requestWakeLock();

    // Reconnexion réseau -> vider la file
    const onOnline = () => {
      if (activeTripIdRef.current) flushQueue(activeTripIdRef.current);
    };
    window.addEventListener("online", onOnline);

    if (!("geolocation" in navigator)) {
      setGpsError("La géolocalisation n'est pas supportée par votre navigateur.");
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        setGpsError(null);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const speed = pos.coords.speed != null ? pos.coords.speed * 3.6 : null; // conversion m/s -> km/h
        const heading = pos.coords.heading ?? null;
        const accuracy = pos.coords.accuracy ?? null;

        setCurrentGps({ lat, lng, speed, heading, accuracy });

        // Throttling adaptatif :
        // Si vitesse > 5 km/h : émission toutes les 5 secondes
        // Si vitesse <= 5 km/h ou arrêt : émission toutes les 15 secondes
        const now = Date.now();
        const minIntervalMs = speed && speed > 5 ? 5000 : 15000;

        if (now - lastEmitTimeRef.current < minIntervalMs) {
          return;
        }

        lastEmitTimeRef.current = now;

        const tripId = activeTripIdRef.current;
        if (!tripId) return;

        const point: StoredGpsPoint = {
          latitude: lat,
          longitude: lng,
          speed: speed ?? undefined,
          heading: heading ?? undefined,
          accuracy: accuracy ?? undefined,
          recordedAt: new Date(pos.timestamp).toISOString(),
        };

        if (!navigator.onLine) {
          // Mode hors-ligne : mise en file d'attente
          const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
          const queue = raw ? JSON.parse(raw) : [];
          queue.push(point);
          localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(-50)));
          setQueuedPointsCount(queue.length);
          return;
        }

        try {
          await ingestTripPositions(tripId, [point]);
          setPointsSentCount((c) => c + 1);
        } catch (_) {
          // Échec réseau temporaire : stockage local
          const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
          const queue = raw ? JSON.parse(raw) : [];
          queue.push(point);
          localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue.slice(-50)));
          setQueuedPointsCount(queue.length);
        }
      },
      (err) => {
        setGpsError(`Erreur GPS : ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      window.removeEventListener("online", onOnline);
      releaseWakeLock();
    };
  }, [isTracking, requestWakeLock, releaseWakeLock, flushQueue]);

  // Actions Chauffeur
  const handleStartTrip = async () => {
    if (!selectedCircuit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await startTrip({
        circuitId: selectedCircuit,
        vehicleId: selectedVehicle || undefined,
        direction,
      });
      activeTripIdRef.current = result.id;
      setIsTracking(true);
      await load();
    } catch (e: unknown) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleEndTrip = async () => {
    const tripId = activeTripIdRef.current;
    if (!tripId) return;

    if (!window.confirm("Êtes-vous sûr de vouloir terminer cette tournée ? Le partage GPS s'arrêtera immédiatement.")) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await endTrip(tripId);
      setIsTracking(false);
      activeTripIdRef.current = null;
      releaseWakeLock();
      localStorage.removeItem(QUEUE_STORAGE_KEY);
      await load();
    } catch (e: unknown) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const handleStopEvent = async (stopId: string, eventType: "arrived" | "students_dropped") => {
    const tripId = activeTripIdRef.current;
    if (!tripId) return;
    try {
      await recordTripStopEvent(tripId, { stopId, eventType });
      await load();
    } catch (e: unknown) {
      alert(`Erreur : ${describeError(e)}`);
    }
  };

  if (loading) {
    return <div className="card driver-console__loading">Chargement de l&apos;espace chauffeur…</div>;
  }

  const activeTrip = session?.activeTrip;

  return (
    <div className="driver-console">
      {/* Alerte et messages d'état */}
      {error && <div className="alert alert--danger">{error}</div>}
      {gpsError && <div className="alert alert--warn">{gpsError}</div>}

      {/* TOURNÉE EN COURS */}
      {activeTrip ? (
        <div className="card driver-console__trip">
          {/* Bandeau clignotant GPS ACTIF */}
          <div className="driver-console__trip-status">
            <div className="driver-console__trip-status-label">
              <span className="driver-console__live-dot" />
              PARTAGE DE POSITION ACTIF
            </div>
            <div className="driver-console__wake-status" data-active={wakeLockActive}>
              {wakeLockActive ? "Écran allumé" : (
                <>
                  <Image src="/danger.svg" alt="" aria-hidden width={14} height={14} className="svg-icon" />
                  Écran standard
                </>
              )}
            </div>
          </div>

          <div className="driver-console__trip-body">
            <div className="driver-console__trip-summary">
              <div>
                <h3 className="driver-console__trip-name">{activeTrip.circuitName}</h3>
                <span className="driver-console__trip-direction">
                  {activeTrip.direction === "pickup" ? "Tournée du Matin (Aller)" : "Tournée du Soir (Retour)"}
                </span>
              </div>
              <div className="driver-console__telemetry">
                <div className="driver-console__speed">
                  {currentGps?.speed != null ? `${Math.round(currentGps.speed)} km/h` : "À l'arrêt"}
                </div>
                <div className="driver-console__telemetry-hint">
                  {pointsSentCount} point(s) transmis {queuedPointsCount > 0 ? `(${queuedPointsCount} en attente)` : ""}
                </div>
              </div>
            </div>

            {/* Avertissement batterie & veille */}
            <div className="driver-console__tip">
              <strong>Conseil chauffeur :</strong> Laissez le smartphone branché à l&apos;allume-cigare sur son support. L&apos;écran est maintenu allumé pour assurer une transmission continue aux parents.
            </div>

            {/* Liste des Arrêts & Confirmation de passage */}
            <h4 className="driver-console__section-title">Feuille de route ({activeTrip.stops.length} arrêts)</h4>
            <div className="driver-console__stops">
              {activeTrip.stops.map((stop, idx) => {
                const stopEvent = activeTrip.stopEvents.find((e) => e.stopId === stop.id);
                const isArrived = stopEvent?.eventType === "arrived" || stopEvent?.eventType === "students_dropped";
                const isDropped = stopEvent?.eventType === "students_dropped";

                return (
                  <div
                    key={stop.id}
                    className="driver-console__stop"
                    data-state={isDropped ? "complete" : isArrived ? "arrived" : "pending"}
                  >
                    <div className="driver-console__stop-heading">
                      <div className="driver-console__stop-copy">
                        <strong className="driver-console__stop-name">
                          #{idx + 1} {stop.name}
                        </strong>
                        {stop.address && <div className="driver-console__stop-address">📍 {stop.address}</div>}
                        {stop.latitude && stop.longitude ? (
                          <div style={{ marginTop: 4 }}>
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${stop.latitude},${stop.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn--sm"
                              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: 11, background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", textDecoration: "none" }}
                            >
                              🧭 Ouvrir itinéraire GPS
                            </a>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                            ⚠️ Position GPS non définie
                          </div>
                        )}
                      </div>

                      {/* Boutons d'actions rapides Chauffeur */}
                      <div className="driver-console__stop-actions">
                        <button
                          type="button"
                          className="btn btn--sm driver-console__stop-action"
                          data-active={isArrived}
                          onClick={() => handleStopEvent(stop.id, "arrived")}
                        >
                          {isArrived ? "✓ Arrivé" : "Arrivé"}
                        </button>

                        <button
                          type="button"
                          className="btn btn--sm driver-console__stop-action driver-console__stop-action--complete"
                          data-active={isDropped}
                          onClick={() => handleStopEvent(stop.id, "students_dropped")}
                        >
                          {isDropped ? "✓ Déposés" : "Déposés"}
                        </button>
                      </div>
                    </div>

                    {/* Élèves à cet arrêt */}
                    <div className="driver-console__students">
                      Élèves ({stop.students.length}) :{" "}
                      {stop.students.length > 0 ? (
                        stop.students.map((st) => (
                          <span key={st.id} className="driver-console__student">
                            {st.displayName}
                          </span>
                        ))
                      ) : (
                        <em className="driver-console__empty">Aucun élève assigné</em>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bouton Clôture Tournée */}
            <div className="driver-console__trip-footer">
              <button
                type="button"
                className="btn btn--danger btn--block driver-console__end-trip"
                disabled={busy}
                onClick={handleEndTrip}
              >
                TERMINER LA TOURNÉE
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* DÉMARRAGE D'UNE NOUVELLE TOURNÉE */
        <div className="card driver-console__start">
          <h2 className="driver-console__start-title">
            <Image src="/bus.svg" alt="" aria-hidden width={22} height={22} className="svg-icon" />
            Démarrer une tournée de transport
          </h2>
          <p className="driver-console__start-description">
            Sélectionnez votre circuit et le sens de circulation. La géolocalisation se déclenchera dès validation pour avertir les parents en direct.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleStartTrip();
            }}
            className="driver-console__form"
          >
            <div>
              <label className="label">
                Circuit à effectuer *
              </label>
              <select
                className="input"
                value={selectedCircuit}
                onChange={(e) => setSelectedCircuit(e.target.value)}
                required
              >
                <option value="">Sélectionner un circuit…</option>
                {session?.circuits.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.stopCount} arrêts · {c.studentCount} élèves)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">
                Sens de circulation *
              </label>
              <div className="driver-console__direction-grid">
                <button
                  type="button"
                  className="driver-console__direction"
                  data-selected={direction === "dropoff"}
                  onClick={() => setDirection("dropoff")}
                >
                  Dépose (Soir)
                  <div>École ➔ Domiciles</div>
                </button>

                <button
                  type="button"
                  className="driver-console__direction"
                  data-selected={direction === "pickup"}
                  onClick={() => setDirection("pickup")}
                >
                  Ramassage (Matin)
                  <div>Domiciles ➔ École</div>
                </button>
              </div>
            </div>

            {session?.vehicles && session.vehicles.length > 0 ? (
              <div>
                <label className="label">
                  Véhicule utilisé (optionnel)
                </label>
                <select
                  className="input"
                  value={selectedVehicle}
                  onChange={(e) => setSelectedVehicle(e.target.value)}
                >
                  <option value="">Véhicule par défaut du circuit</option>
                  {session.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.plateNumber} {v.model ? `(${v.model})` : ""} {v.capacity ? `· ${v.capacity} places` : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <button
              type="submit"
              className="btn btn--primary btn--block driver-console__start-trip"
              disabled={busy || !selectedCircuit}
            >
              DÉMARRER LA TOURNÉE
            </button>
          </form>

          {/* Notice Loi 09-08 */}
          <div className="driver-console__privacy">
            <strong>
              <Image src="/lock.svg" alt="" aria-hidden width={16} height={16} className="svg-icon svg-icon--inline" />
              Conformité Loi 09-08 & CNDP :
            </strong>{" "}
            Vos coordonnées GPS sont partagées en direct uniquement après avoir cliqué sur &quot;Démarrer&quot; et s&apos;arrêtent dès le clic sur &quot;Terminer&quot;.
          </div>
        </div>
      )}
    </div>
  );
}
