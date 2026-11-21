"use client";

import { useEffect, useRef, useState } from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";

interface InteractiveLocationPickerProps {
  initialLat?: number | null;
  initialLng?: number | null;
  initialAddress?: string | null;
  onSave: (coords: { latitude: number; longitude: number; address?: string; relocateDemoSchool?: boolean }) => Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}

export function InteractiveLocationPicker({
  initialLat,
  initialLng,
  initialAddress,
  onSave,
  onCancel,
  busy = false,
}: InteractiveLocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const leafletRef = useRef<typeof L | null>(null);

  const [lat, setLat] = useState<number>(initialLat ?? 33.5866);
  const [lng, setLng] = useState<number>(initialLng ?? -7.6326);
  const [address, setAddress] = useState<string>(initialAddress ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [gpsDetecting, setGpsDetecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [relocateDemoSchool, setRelocateDemoSchool] = useState(true);

  // Initialisation de la carte Leaflet
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let isMounted = true;

    import("leaflet").then((leafletModule) => {
      if (!isMounted || !mapContainerRef.current) return;
      const L = leafletModule.default ?? leafletModule;
      leafletRef.current = L;

      // Nettoyage si déjà initialisé
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {
          // ignorer
        }
        mapRef.current = null;
      }

      // Nettoyer l'ID résiduel Leaflet sur le conteneur DOM pour éviter l'erreur "already initialized"
      const el = mapContainerRef.current as HTMLElement & { _leaflet_id?: number | null };
      if (el._leaflet_id != null) {
        el._leaflet_id = null;
      }

      try {
        const map = L.map(mapContainerRef.current, {
          center: [lat, lng],
          zoom: initialLat && initialLng ? 16 : 13,
        });
        mapRef.current = map;

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);

        // Icône personnalisée pour le domicile
        const homeHtml = `
          <div style="background:#0284c7;color:#fff;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;box-shadow:0 4px 14px rgba(2,132,199,0.5);white-space:nowrap;border:2.5px solid #fff;cursor:grab;">
            <span>🏠</span> <span>Mon Domicile (Déplacez-moi)</span>
          </div>
        `;

        const icon = L.divIcon({
          html: homeHtml,
          className: "orya-picker-marker",
          iconSize: [160, 36],
          iconAnchor: [80, 18],
        });

        const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);
        markerRef.current = marker;

        // Événement déplacement du marqueur
        marker.on("dragend", () => {
          const position = marker.getLatLng();
          setLat(Number(position.lat.toFixed(6)));
          setLng(Number(position.lng.toFixed(6)));
        });

        // Événement clic sur la carte pour déplacer le marqueur
        map.on("click", (e: L.LeafletMouseEvent) => {
          const clickedLat = Number(e.latlng.lat.toFixed(6));
          const clickedLng = Number(e.latlng.lng.toFixed(6));
          marker.setLatLng([clickedLat, clickedLng]);
          setLat(clickedLat);
          setLng(clickedLng);
        });
      } catch (err) {
        console.warn("InteractiveLocationPicker: réinitialisation sécurisée", err);
      }
    });

    return () => {
      isMounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Déplacement du marqueur quand lat/lng changent
  const updateMapPosition = (newLat: number, newLng: number, zoomLevel = 16) => {
    setLat(newLat);
    setLng(newLng);
    if (markerRef.current) {
      markerRef.current.setLatLng([newLat, newLng]);
    }
    if (mapRef.current) {
      mapRef.current.flyTo([newLat, newLng], zoomLevel, { duration: 1 });
    }
  };

  // 1. Détection GPS de l'appareil
  const handleDetectGPS = () => {
    setStatusMessage(null);
    if (typeof window === "undefined" || !navigator.geolocation) {
      setStatusMessage({ tone: "error", text: "La géolocalisation n'est pas supportée par votre navigateur." });
      return;
    }

    setGpsDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsDetecting(false);
        const detectedLat = Number(pos.coords.latitude.toFixed(6));
        const detectedLng = Number(pos.coords.longitude.toFixed(6));
        const accuracy = Math.round(pos.coords.accuracy);

        updateMapPosition(detectedLat, detectedLng, 17);
        setStatusMessage({
          tone: "ok",
          text: `Position GPS détectée avec succès (Précision : ±${accuracy}m). Vous pouvez ajuster le repère en cliquant sur votre toit/immeuble exact.`,
        });
      },
      (err) => {
        setGpsDetecting(false);
        let msg = "Impossible d'obtenir la position GPS.";
        if (err.code === 1) msg = "Accès à la position refusé. Veuillez autoriser la géolocalisation dans votre navigateur.";
        else if (err.code === 2) msg = "Signal GPS indisponible. Activez la localisation de votre appareil ou recherchez votre ville ci-dessus.";
        else if (err.code === 3) msg = "Délai dépassé. Vous pouvez chercher votre ville ou déplacer la carte.";
        setStatusMessage({ tone: "error", text: msg });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  // 2. Recherche d'adresse ou ville via Nominatim OpenStreetMap
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    setStatusMessage(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery.trim())}&limit=5&addressdetails=1`;
      const res = await fetch(url, { headers: { "Accept-Language": "fr,ar" } });
      if (!res.ok) throw new Error("Erreur de recherche");
      const data = await res.json();

      if (Array.isArray(data) && data.length > 0) {
        setSearchResults(data);
        const first = data[0];
        const searchLat = Number(parseFloat(first.lat).toFixed(6));
        const searchLng = Number(parseFloat(first.lon).toFixed(6));
        updateMapPosition(searchLat, searchLng, 16);
        setAddress(first.display_name.split(",")[0] || searchQuery);
        setStatusMessage({ tone: "ok", text: `Résultat trouvé : ${first.display_name.slice(0, 70)}...` });
      } else {
        setSearchResults([]);
        setStatusMessage({ tone: "info", text: "Aucun résultat trouvé pour cette recherche. Vous pouvez déplacer le marqueur directement sur la carte." });
      }
    } catch {
      setStatusMessage({ tone: "error", text: "Impossible de contacter le service de géocodage. Déplacez le marqueur manuellement sur la carte." });
    } finally {
      setSearching(false);
    }
  };

  // Soumission
  const handleSubmit = async () => {
    await onSave({
      latitude: lat,
      longitude: lng,
      address: address.trim() || undefined,
      relocateDemoSchool,
    });
  };

  return (
    <div className="card stack interactive-location-picker" style={{ border: "2px solid #3b82f6", background: "#f8fafc", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ fontSize: 17, fontWeight: 800, color: "#1e293b", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span>📍</span> Définir l&apos;emplacement exact de votre domicile
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 4, marginBottom: 0 }}>
            Cliquez sur la carte ou déplacez le marqueur pour pointer votre maison au mètre près.
          </p>
        </div>

        <button
          type="button"
          className="btn btn--sm"
          style={{ background: "#0284c7", color: "#ffffff", fontWeight: 700 }}
          disabled={gpsDetecting}
          onClick={handleDetectGPS}
        >
          {gpsDetecting ? "⏳ Détection GPS…" : "🎯 Détecter ma position GPS réelle"}
        </button>
      </div>

      {statusMessage ? (
        <div className={`alert alert--${statusMessage.tone}`} style={{ fontSize: 13, margin: 0 }}>
          {statusMessage.text}
        </div>
      ) : null}

      {/* Barre de recherche d'adresse / ville */}
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="text"
          className="input"
          placeholder="Rechercher une ville, quartier ou rue (ex : Agdal Rabat, Guéliz Marrakech, Tanger, Paris...)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: "1 1 280px" }}
        />
        <button type="submit" className="btn btn--secondary" disabled={searching || !searchQuery.trim()}>
          {searching ? "Recherche…" : "🔍 Rechercher"}
        </button>
      </form>

      {/* Résultats de recherche multiples */}
      {searchResults.length > 1 ? (
        <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 6, padding: 8, maxHeight: 140, overflowY: "auto", fontSize: 12 }}>
          <strong style={{ display: "block", marginBottom: 4, color: "#475569" }}>Suggestions trouvées :</strong>
          <ul className="list-reset stack" style={{ gap: 4 }}>
            {searchResults.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "4px 6px", cursor: "pointer", color: "#0284c7", textDecoration: "underline" }}
                  onClick={() => {
                    const selLat = Number(parseFloat(r.lat).toFixed(6));
                    const selLng = Number(parseFloat(r.lon).toFixed(6));
                    updateMapPosition(selLat, selLng, 16);
                    setAddress(r.display_name.split(",")[0] || "");
                    setSearchResults([]);
                  }}
                >
                  📍 {r.display_name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Conteneur de la carte interactive */}
      <div
        ref={mapContainerRef}
        style={{
          height: 340,
          width: "100%",
          borderRadius: 8,
          border: "1.5px solid #cbd5e1",
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        }}
      />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", background: "#ffffff", padding: "10px 14px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 13 }}>
        <div>
          <span className="muted">Latitude : </span>
          <strong>{lat.toFixed(6)}</strong>
        </div>
        <div>
          <span className="muted">Longitude : </span>
          <strong>{lng.toFixed(6)}</strong>
        </div>
        <div style={{ color: "#059669", fontWeight: 600 }}>
          ✓ Pointeur placé avec précision
        </div>
      </div>

      {/* Champ d'adresse et repère pour le chauffeur */}
      <div className="field">
        <label className="label" htmlFor="address-input">
          Complément d&apos;adresse ou repère pour le chauffeur (optionnel)
        </label>
        <input
          id="address-input"
          type="text"
          className="input"
          placeholder="Ex : Villa N°14, Résidence Les Oliviers, en face de la pharmacie..."
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={180}
        />
      </div>

      {/* Option pour déplacer également l'école de test à proximité */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", background: "#eff6ff", padding: "8px 12px", borderRadius: 6, border: "1px solid #bfdbfe" }}>
        <input
          type="checkbox"
          checked={relocateDemoSchool}
          onChange={(e) => setRelocateDemoSchool(e.target.checked)}
        />
        <span>
          <strong>Simuler l&apos;école à proximité (~1,5 km)</strong> : Déplace également l&apos;école de test dans ma ville pour que la simulation du bus parte d&apos;ici et roule jusqu&apos;à chez moi.
        </span>
      </label>

      {/* Boutons d'action */}
      <div className="row" style={{ gap: 10, marginTop: 4 }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          style={{ background: "#16a34a", color: "#ffffff", fontWeight: 700, padding: "10px 20px" }}
          onClick={handleSubmit}
        >
          {busy ? "Enregistrement…" : "✓ Valider et enregistrer ce point de ramassage"}
        </button>

        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy}
          onClick={onCancel}
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
