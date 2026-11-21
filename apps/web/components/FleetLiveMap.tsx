"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useCallback } from "react";
import { LeafletMapAdapter } from "@/lib/map-adapter";
import {
  createTransportVehicle,
  describeError,
  getFleetOverview,
  toggleTransportTracking,
  updateStopCoordinates,
  type FleetOverviewView,
} from "@/lib/api";
import "leaflet/dist/leaflet.css";

export function FleetLiveMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<LeafletMapAdapter | null>(null);

  const [fleet, setFleet] = useState<FleetOverviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Formulaire véhicule
  const [newPlate, setNewPlate] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newCapacity, setNewCapacity] = useState("24");

  // Édition de coordonnées d'arrêt
  const [selectedStopId, setSelectedStopId] = useState("");
  const [stopLat, setStopLat] = useState("");
  const [stopLng, setStopLng] = useState("");
  const [stopAddress, setStopAddress] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getFleetOverview();
      setFleet(data);
    } catch (e: unknown) {
      console.error("Erreur chargement flotte:", describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Initialisation carte générale de la flotte
  useEffect(() => {
    if (!mapContainerRef.current || !fleet) return;
    let isMounted = true;

    const adapter = new LeafletMapAdapter();
    adapterRef.current = adapter;

    const schoolLoc = fleet.school;
    const center = schoolLoc?.latitude && schoolLoc?.longitude
      ? [schoolLoc.latitude, schoolLoc.longitude] as [number, number]
      : [33.5898, -7.6038] as [number, number];

    adapter.init(mapContainerRef.current, { center, zoom: 13 }).then(() => {
      if (!isMounted) {
        adapter.destroy();
        return;
      }
      // 1. Marqueur école
      if (schoolLoc?.latitude && schoolLoc?.longitude) {
        adapter.setSchoolMarker(schoolLoc.latitude, schoolLoc.longitude, schoolLoc.name);
      }

      // 2. Marqueurs des tournées actives
      for (const trip of fleet.activeTrips) {
        if (trip.latestPosition) {
          adapter.updateBusPosition(
            trip.latestPosition.latitude,
            trip.latestPosition.longitude,
            trip.latestPosition.heading,
            trip.latestPosition.speed,
          );
        }
      }

      // 3. Marqueurs des arrêts enregistrés
      for (const circuit of fleet.circuits) {
        for (const stop of circuit.stops) {
          if (stop.latitude && stop.longitude) {
            adapter.setStopMarker(stop.latitude, stop.longitude, `${circuit.name} · ${stop.name}`, false);
          }
        }
      }

      adapter.fitBounds();
    });

    return () => {
      isMounted = false;
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [fleet]);

  const handleToggleTracking = async () => {
    if (!fleet) return;
    const nextState = !fleet.school.transportTrackingEnabled;
    setBusy(true);
    try {
      await toggleTransportTracking(nextState);
      setNotice(`Suivi GPS transport ${nextState ? "activé" : "désactivé"} pour l'établissement.`);
      await load();
    } catch (e: unknown) {
      setNotice(`Erreur : ${describeError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlate) return;
    setBusy(true);
    try {
      await createTransportVehicle({
        plateNumber: newPlate.trim(),
        model: newModel.trim() || undefined,
        capacity: newCapacity ? Number(newCapacity) : undefined,
      });
      setNewPlate("");
      setNewModel("");
      setNotice("Véhicule ajouté au parc.");
      await load();
    } catch (e: unknown) {
      setNotice(`Erreur : ${describeError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateStopLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStopId || !stopLat || !stopLng) return;
    setBusy(true);
    try {
      await updateStopCoordinates(selectedStopId, {
        latitude: parseFloat(stopLat),
        longitude: parseFloat(stopLng),
        address: stopAddress.trim() || undefined,
      });
      setNotice("Coordonnées GPS de l'arrêt enregistrées.");
      setSelectedStopId("");
      setStopLat("");
      setStopLng("");
      setStopAddress("");
      await load();
    } catch (e: unknown) {
      setNotice(`Erreur : ${describeError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="card fleet-console__loading">Chargement de la supervision flotte…</div>;
  }

  const allStops = fleet?.circuits.flatMap((c) => c.stops.map((s) => ({ ...s, circuitName: c.name }))) ?? [];

  return (
    <div className="fleet-console">
      {notice && (
        <div className="alert alert--ok fleet-console__notice">
          <span>{notice}</span>
          <button className="fleet-console__dismiss" type="button" onClick={() => setNotice(null)} aria-label="Fermer">✕</button>
        </div>
      )}

      {/* Bandeau d'état et interrupteur école */}
      <div className="card fleet-console__summary">
        <div>
          <h3 className="fleet-console__summary-title">Supervision de la flotte & géolocalisation</h3>
          <p className="muted fleet-console__summary-hint">
            {fleet?.activeTrips.length ?? 0} tournée(s) active(s) · {fleet?.vehicles.length ?? 0} véhicule(s) dans le parc
          </p>
        </div>

        <div className="fleet-console__tracking-control">
          <span className="fleet-console__tracking" data-active={fleet?.school.transportTrackingEnabled === true}>
            <span className="fleet-console__tracking-dot" />
            Suivi GPS : {fleet?.school.transportTrackingEnabled ? "Activé" : "Désactivé"}
          </span>
          <button
            type="button"
            className={`btn btn--sm ${fleet?.school.transportTrackingEnabled ? "btn--ghost" : "btn--primary"}`}
            disabled={busy}
            onClick={handleToggleTracking}
          >
            {fleet?.school.transportTrackingEnabled ? "Désactiver le tracking" : "Activer le tracking"}
          </button>
        </div>
      </div>

      {/* Carte Générale de la Flotte */}
      <div className="fleet-console__map-card">
        <div className="fleet-console__map-heading">
          <Image src="/map.svg" alt="" aria-hidden width={18} height={18} className="svg-icon" />
          Position en direct des navettes scolaires (OpenStreetMap)
        </div>
        <div ref={mapContainerRef} className="fleet-console__map" />
      </div>

      {/* Tournées Actives */}
      <div className="card fleet-console__active-trips">
        <h4 className="fleet-console__section-title">Tournées en cours en direct</h4>
        {fleet?.activeTrips && fleet.activeTrips.length > 0 ? (
          <div className="fleet-console__trip-grid">
            {fleet.activeTrips.map((t) => (
              <div key={t.id} className="fleet-console__trip-card">
                <div className="fleet-console__trip-heading">
                  <strong className="fleet-console__trip-name">{t.circuitName}</strong>
                  <span className="fleet-console__trip-badge">
                    EN ROUTE
                  </span>
                </div>
                <div className="fleet-console__trip-meta">
                  Chauffeur : <strong>{t.driverName}</strong> · Véhicule : {t.vehiclePlate}
                </div>
                <div className="fleet-console__trip-direction">
                  Direction : {t.direction === "pickup" ? "Ramassage (Matin)" : "Dépose (Soir)"} · {t.stopCount} arrêt(s)
                </div>
                {t.latestPosition && (
                  <div className="fleet-console__trip-position">
                    <Image src="/map.svg" alt="" aria-hidden width={15} height={15} className="svg-icon" />
                    {t.latestPosition.speed != null ? `${Math.round(t.latestPosition.speed)} km/h` : "À l'arrêt"} · Dernière position : {new Date(t.latestPosition.recordedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted fleet-console__empty">
            Aucun bus ne circule actuellement. Le suivi s&apos;activera automatiquement dès qu&apos;un chauffeur démarrera une tournée.
          </p>
        )}
      </div>

      {/* Configuration : Arrêts GPS & Véhicules */}
      <div className="fleet-console__config-grid">
        {/* Géolocaliser un Arrêt */}
        <div className="card fleet-console__config-card">
          <h4 className="fleet-console__section-title">
            <Image src="/map.svg" alt="" aria-hidden width={18} height={18} className="svg-icon svg-icon--inline" />
            Géolocaliser un arrêt (Calcul ETA 5 min)
          </h4>
          <form className="fleet-console__form" onSubmit={handleUpdateStopLocation}>
            <div>
              <label className="label">Arrêt à géolocaliser *</label>
              <select
                className="input"
                value={selectedStopId}
                onChange={(e) => {
                  setSelectedStopId(e.target.value);
                  const found = allStops.find((s) => s.id === e.target.value);
                  if (found) {
                    setStopLat(found.latitude != null ? String(found.latitude) : "");
                    setStopLng(found.longitude != null ? String(found.longitude) : "");
                    setStopAddress(found.address ?? "");
                  }
                }}
                required
              >
                <option value="">Sélectionner un arrêt…</option>
                {allStops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.circuitName} ➔ #{s.position} {s.name} {s.latitude ? "✓ GPS" : "Sans GPS"}
                  </option>
                ))}
              </select>
            </div>

            <div className="fleet-console__coordinates">
              <div>
                <label className="label">Latitude (ex: 33.582)</label>
                <input
                  type="number"
                  step="any"
                  className="input"
                  placeholder="33.582"
                  value={stopLat}
                  onChange={(e) => setStopLat(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label">Longitude (ex: -7.632)</label>
                <input
                  type="number"
                  step="any"
                  className="input"
                  placeholder="-7.632"
                  value={stopLng}
                  onChange={(e) => setStopLng(e.target.value)}
                  required
                />
              </div>
            </div>

            <div>
              <label className="label">Adresse / Repère (optionnel)</label>
              <input
                type="text"
                className="input"
                placeholder="Ex: Angle Bd Roudani & Rue d'Alsace"
                value={stopAddress}
                onChange={(e) => setStopAddress(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !selectedStopId}>
              Enregistrer les coordonnées
            </button>
          </form>
        </div>

        {/* Parc de Véhicules */}
        <div className="card fleet-console__config-card">
          <h4 className="fleet-console__section-title">
            <Image src="/bus.svg" alt="" aria-hidden width={18} height={18} className="svg-icon svg-icon--inline" />
            Ajouter un véhicule au parc
          </h4>
          <form className="fleet-console__form" onSubmit={handleCreateVehicle}>
            <div>
              <label className="label">Immatriculation *</label>
              <input
                type="text"
                className="input"
                placeholder="Ex: 12345-A-6"
                value={newPlate}
                onChange={(e) => setNewPlate(e.target.value)}
                required
              />
            </div>

            <div className="fleet-console__coordinates">
              <div>
                <label className="label">Modèle</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Ex: Mercedes Sprinter"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Capacité (places)</label>
                <input
                  type="number"
                  className="input"
                  placeholder="24"
                  value={newCapacity}
                  onChange={(e) => setNewCapacity(e.target.value)}
                />
              </div>
            </div>

            <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !newPlate}>
              Ajouter le bus
            </button>
          </form>

          {/* Liste des bus */}
          {fleet?.vehicles && fleet.vehicles.length > 0 ? (
            <div className="fleet-console__vehicle-list">
              <div className="fleet-console__list-label">Bus enregistrés :</div>
              <ul>
                {fleet.vehicles.map((v) => (
                  <li key={v.id}>
                    <strong>{v.plateNumber}</strong> {v.model ? `(${v.model})` : ""} · {v.capacity ?? "?"} places
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
