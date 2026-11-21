/**
 * Adaptateur cartographique abstrait pour ORYA.
 * Permet d'isoler le fournisseur de carte (Leaflet/OSM par défaut, facilement
 * substituable par Mapbox ou Google Maps à l'avenir).
 */

import type * as L from "leaflet";

export type LatLng = [number, number];

export interface MapAdapterOptions {
  center: LatLng;
  zoom: number;
  interactive?: boolean;
}

export interface MapAdapter {
  init(container: HTMLElement, options?: MapAdapterOptions): Promise<void>;
  setSchoolMarker(lat: number, lng: number, label?: string): void;
  setStopMarker(lat: number, lng: number, label: string, isChildStop?: boolean): void;
  clearStopMarkers?(): void;
  updateBusPosition(lat: number, lng: number, heading?: number | null, speed?: number | null): void;
  setRoutePath(points: LatLng[]): void;
  fitBounds(): void;
  destroy(): void;
}

export class LeafletMapAdapter implements MapAdapter {
  private map: L.Map | null = null;
  private L: typeof L | null = null;
  private schoolMarker: L.Marker | null = null;
  private stopMarkers = new Map<string, L.Marker>();
  private busMarker: L.Marker | null = null;
  private routeLine: L.Polyline | null = null;
  private isDestroyed = false;

  async init(container: HTMLElement, options?: MapAdapterOptions): Promise<void> {
    if (typeof window === "undefined" || !container) return;
    this.isDestroyed = false;

    // 1. Si cette instance gère déjà une carte, la détruire proprement
    if (this.map) {
      try {
        this.map.remove();
      } catch {
        // ignorer
      }
      this.map = null;
    }

    // 2. Réinitialisation de l'attribut interne _leaflet_id sur le conteneur DOM
    const el = container as HTMLElement & { _leaflet_id?: number | null };
    if (el._leaflet_id != null) {
      el._leaflet_id = null;
    }

    // 3. Import dynamique côté client
    const leaflet = await import("leaflet");
    if (this.isDestroyed) return;
    this.L = leaflet.default ?? leaflet;

    // 4. Double sécurité juste avant l'appel à L.map (évite "Map container is already initialized")
    if (el._leaflet_id != null) {
      el._leaflet_id = null;
    }

    const center = options?.center ?? [33.5898, -7.6038]; // Casablanca par défaut
    const zoom = options?.zoom ?? 14;

    try {
      this.map = this.L.map(container, {
        center,
        zoom,
        zoomControl: true,
        attributionControl: true,
      });

      this.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(this.map);
    } catch (err) {
      console.warn("LeafletMapAdapter: réinitialisation sécurisée du conteneur", err);
    }
  }

  clearStopMarkers(): void {
    if (this.map) {
      this.stopMarkers.forEach((m) => this.map?.removeLayer(m));
    }
    this.stopMarkers.clear();
  }

  setSchoolMarker(lat: number, lng: number, label = "École"): void {
    if (!this.map || !this.L) return;
    if (this.schoolMarker) this.map.removeLayer(this.schoolMarker);

    const schoolHtml = `
      <div style="background:#0f766e;color:#fff;padding:4px 8px;border-radius:16px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:4px;box-shadow:0 3px 8px rgba(0,0,0,0.3);white-space:nowrap;border:2px solid #fff;">
        <span>🏫</span> ${label}
      </div>
    `;

    const icon = this.L.divIcon({
      html: schoolHtml,
      className: "orya-map-school-pin",
      iconSize: [80, 32],
      iconAnchor: [40, 16],
    });

    this.schoolMarker = this.L.marker([lat, lng], { icon }).addTo(this.map);
  }

  setStopMarker(lat: number, lng: number, label: string, isChildStop = false): void {
    if (!this.map || !this.L) return;
    const existing = this.stopMarkers.get(label);
    if (existing) {
      this.map.removeLayer(existing);
      this.stopMarkers.delete(label);
    }

    const stopHtml = isChildStop
      ? `
      <div style="background:#0284c7;color:#fff;padding:4px 10px;border-radius:16px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:4px;box-shadow:0 4px 12px rgba(2,132,199,0.5);white-space:nowrap;border:2px solid #fff;animation:orya-pulse 2s infinite;">
        <span>⭐</span> <span>${label} (Votre arrêt)</span>
      </div>
    `
      : `
      <div style="background:#475569;color:#fff;padding:3px 7px;border-radius:12px;font-size:11px;font-weight:600;display:flex;align-items:center;gap:3px;box-shadow:0 2px 5px rgba(0,0,0,0.2);white-space:nowrap;border:1.5px solid #fff;">
        <span>🚏</span> <span>${label}</span>
      </div>
    `;

    const icon = this.L.divIcon({
      html: stopHtml,
      className: `orya-map-stop-${isChildStop ? "child" : "standard"}`,
      iconSize: isChildStop ? [140, 30] : [90, 24],
      iconAnchor: isChildStop ? [70, 15] : [45, 12],
    });

    const marker = this.L.marker([lat, lng], { icon }).addTo(this.map);
    this.stopMarkers.set(label, marker);
  }

  updateBusPosition(lat: number, lng: number, heading: number | null = 0, speed: number | null = null): void {
    if (!this.map || !this.L) return;

    const angle = heading ?? 0;
    const speedLabel = speed != null && speed > 3 ? `${Math.round(speed)} km/h` : "À l'arrêt";

    const busHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;transition:transform 0.8s ease-out;">
        <div style="background:#1e293b;color:#f8fafc;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;margin-bottom:2px;box-shadow:0 2px 4px rgba(0,0,0,0.3);white-space:nowrap;">
          🚌 ${speedLabel}
        </div>
        <div style="width:36px;height:36px;background:#f59e0b;border:3px solid #ffffff;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 10px rgba(245,158,11,0.6);transform:rotate(${angle}deg);transition:transform 0.4s ease;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e293b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="16" rx="3"></rect>
            <path d="M7 19v2"></path>
            <path d="M17 19v2"></path>
            <circle cx="7.5" cy="14.5" r="1.5"></circle>
            <circle cx="16.5" cy="14.5" r="1.5"></circle>
            <path d="M3 10h18"></path>
          </svg>
        </div>
      </div>
    `;

    if (!this.busMarker) {
      const icon = this.L.divIcon({
        html: busHtml,
        className: "orya-bus-marker",
        iconSize: [70, 56],
        iconAnchor: [35, 36],
      });
      this.busMarker = this.L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(this.map);
    } else {
      // Déplacement animé
      this.busMarker.setLatLng([lat, lng]);
      const el = this.busMarker.getElement();
      if (el) {
        el.innerHTML = busHtml;
      }
    }
  }

  setRoutePath(points: LatLng[]): void {
    if (!this.map || !this.L || points.length < 2) return;
    if (this.routeLine) this.map.removeLayer(this.routeLine);

    this.routeLine = this.L.polyline(points, {
      color: "#0284c7",
      weight: 4,
      opacity: 0.75,
      dashArray: "6, 8",
      lineJoin: "round",
    }).addTo(this.map);
  }

  fitBounds(): void {
    if (!this.map || !this.L) return;
    const group: (L.Marker | L.Polyline)[] = [];
    if (this.schoolMarker) group.push(this.schoolMarker);
    if (this.busMarker) group.push(this.busMarker);
    this.stopMarkers.forEach((m) => group.push(m));

    if (group.length > 0) {
      const featureGroup = this.L.featureGroup(group);
      this.map.fitBounds(featureGroup.getBounds().pad(0.2));
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    if (this.map) {
      try {
        this.map.remove();
      } catch {
        // ignorer
      }
      this.map = null;
    }
    this.schoolMarker = null;
    this.stopMarkers.clear();
    this.busMarker = null;
    this.routeLine = null;
  }
}
