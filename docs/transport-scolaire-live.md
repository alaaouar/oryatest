# Transport Scolaire — Suivi en Temps Réel & Géolocalisation

Module de suivi en direct des navettes scolaires ORYA pour les parents, les chauffeurs et la direction d'établissement scolaire.

---

## 1. Vue d'ensemble de l'architecture

Le module se compose de trois interfaces interconnectées en temps réel :

1. **Espace Parent (`LiveBusMap`)** :
   - Mini-carte interactive affichant l'école, l'arrêt attribué à l'enfant et l'icône animée du bus scolaire orientée selon son cap.
   - Calcul et affichage dynamique de l'ETA (« Arrive dans ~5 min ») et de la distance restante.
   - **Règle de minimisation stricte** : Le parent ne voit *que* l'arrêt de son propre enfant et la position du bus affecté à sa tournée. Aucun autre enfant ni autre arrêt n'est exposé.

2. **Cockpit Chauffeur (`DriverLiveConsole`)** :
   - Écran mobile-first pour le rôle `chauffeur` / `bus_attendant`.
   - Sélection du circuit et bouton « Démarrer la tournée » (Aller ou Retour).
   - Télémétrie GPS adaptative : envoi toutes les 5 s en mouvement, 15 s à l'arrêt pour préserver la batterie.
   - **Screen Wake Lock API** : maintien de l'écran allumé pendant toute la tournée active avec badge vert « Partage de position actif ».
   - **File d'attente hors-ligne** : mise en cache locale des points GPS en zone blanche 3G/4G et synchronisation automatique dès retour du réseau.
   - Validation pas-à-pas des arrêts : boutons « Arrivé à l'arrêt » et « Élèves déposés ».

3. **Console Direction (`FleetLiveMap`)** :
   - Vue flotte d'ensemble : position de tous les bus actifs de l'école.
   - Gestion du parc de véhicules (immatriculation, modèle, capacité).
   - Éditeur de coordonnées GPS et de rayon de détection des arrêts.
   - Interrupteur général de conformité CNDP : activation/désactivation de la géolocalisation pour l'établissement.

---

## 2. Temps Réel & Conformité T17 (Server-Sent Events)

Conformément à la règle d'architecture **T17** du projet interdisant les passerelles WebSocket (`@WebSocketGateway`, `socket.io`, `ws`), le flux temps réel est assuré par **Server-Sent Events (SSE)** natif :
- Point d'entrée API : `GET /api/v1/transport/trips/:id/live`
- Authentification : Token JWT contrôlé dans le `TenancyService` (vérification stricte de l'accès parent/chauffeur/direction).
- Format d'événement standard :
  ```json
  {
    "tripId": "uuid",
    "type": "position" | "trip_status" | "stop_event",
    "latitude": 33.5866,
    "longitude": -7.6326,
    "speed": 28,
    "heading": 180,
    "recordedAt": "2026-11-19T20:30:00.000Z"
  }
  ```

---

## 3. Fournisseur de Cartographie & Adaptateur

L'affichage cartographique repose sur un patron **Adapter** découplé (`MapAdapter` dans `apps/web/lib/map-adapter.ts`).

- **Fournisseur par défaut** : **Leaflet + OpenStreetMap / CartoDB** (100% open-source, zéro clé API requise, tuiles légères adaptées aux connexions mobiles marocaines).
- **Remplacement vers Google Maps ou Mapbox** :
  L'interface TypeScript `MapAdapter` expose :
  ```typescript
  export interface MapAdapter {
    initialize(container: HTMLElement, options: MapOptions): void;
    updateBusPosition(position: LatLng, heading?: number): void;
    fitBounds(): void;
    destroy(): void;
  }
  ```
  Pour basculer vers Mapbox GL ou Google Maps, il suffit d'implémenter un `GoogleMapsAdapter` ou `MapboxAdapter` respectant cette même interface sans toucher aux composants React.

### Variables d'environnement

Dans `apps/web/.env.local` :
```env
NEXT_PUBLIC_MAP_PROVIDER=leaflet # ou "mapbox" / "google_maps"
NEXT_PUBLIC_MAP_TILE_URL=https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png
```

---

## 4. Notifications 5 Minutes & Anti-Doublons

Le service `TransportEtaService` combine la distance Haversine avec un facteur de détour urbain marocain (1.35x) pour estimer l'ETA en minutes.

- **Fenêtre 5 minutes** : déclenchée dès que `etaMinutes <= 5` et `distanceMeters <= 3000m`.
- **Idempotence stricte (Anti-doublons & Anti-gigue GPS)** :
  - Chaque notification envoyée est persistée dans la table `TransportNotificationLog` avec une contrainte unique `@@unique([tripId, studentId, notificationType])`.
  - Si le GPS oscille ou si la vitesse fluctue autour du seuil de 5 minutes, aucune notification supplémentaire n'est générée.
  - Canaux : In-app (`Notification` dans l'espace parent) + Web Push.

---

## 5. Conformité Légale Maroc (Loi 09-08 & CNDP)

La géolocalisation des navettes scolaires concerne des mineurs et fait l'objet d'un encadrement strict :

1. **Principe de finalité** : Collecte autorisée exclusivement pour la sécurité des élèves et l'information des tuteurs. L'API rejette systématiquement toute ingestion de coordonnées si la tournée n'a pas le statut `in_progress`. Dès que le chauffeur clique sur « Terminer la tournée », le flux GPS est coupé côté client et refusé côté serveur.
2. **Durée de conservation (30 jours)** : Conformément aux recommandations de la CNDP, les coordonnées GPS sont conservées au maximum 30 jours. La méthode `TransportService.cleanupOldPositions()` exécute la purge automatique :
   ```sql
   DELETE FROM "BusTripPosition" WHERE "recordedAt" < NOW() - INTERVAL '30 days';
   ```
3. **Information préalable bilingue (Français / Arabe)** : La notice d'information obligatoire est accessible sur toutes les interfaces de suivi.
4. **Scoping multi-tenant (RLS)** : Toutes les tables (`BusVehicle`, `BusTrip`, `BusTripPosition`, `BusTripStopEvent`, `TransportNotificationLog`) portent la clé `schoolId` avec politiques RLS PostgreSQL forcées (`FORCE ROW LEVEL SECURITY`).

---

## 6. Limites des Plateformes & Arbitrages Techniques

### Suivi en arrière-plan sur navigateur Web (PWA)
- **Constat technique** : Sur Android (Chrome) et iOS (Safari/WebKit), un onglet web mis en arrière-plan ou avec écran verrouillé voit ses timers JavaScript bridés et l'accès GPS suspendu par l'OS au bout de 10 à 30 secondes.
- **Solution Web / PWA retenue** :
  - Utilisation de la **Screen Wake Lock API** pour empêcher la mise en veille tant que le chauffeur conduit.
  - Alerte sonore et visuelle si la page perd le focus ou la connexion.
  - File d'attente IndexedDB / mémoire stockant les points GPS et les rejouant dès reconnexion.
- **Solution pérenne (Lot 5 — Application mobile Flutter)** :
  - Au Lot 5, l'application mobile dédiée utilisera un service natif d'arrière-plan Android (`Foreground Service` avec notification persistante dans la barre d'état) et `Significant Location Changes` sous iOS.

---

## 7. Simulateur de Trajet (Rejeu GPS Démo)

Un script de simulation réaliste est inclus pour rejouer une tournée complète à Casablanca sans bus physique :

```bash
# Dans apps/api
npx tsx prisma/simulate-trip.ts         # Vitesse normale (1.2s entre chaque point)
npx tsx prisma/simulate-trip.ts --fast  # Rejeu accéléré pour tests automatisés
```

### Déroulement du scénario de démonstration :
1. Configure l'école **Groupe Scolaire Al Atlas** à Casablanca (`33.5898, -7.6038`).
2. Associe le véhicule Mercedes-Benz Sprinter `12345-A-6` au circuit *Maarif & Gauthier*.
3. Démarrage de la tournée retour (`dropoff`) par le chauffeur Hassan Chraibi.
4. Départ de l'école vers le Boulevard Zerktouni (points 1 à 5).
5. Arrivée à l'Arrêt 1 (Clinique Badr) et validation de la dépose.
6. Le bus repart vers le Twin Center : passage du seuil 5 minutes pour l'élève **Mehdi Benjelloun** $\rightarrow$ déclenchement de l'alerte push parent.
7. Arrivée à l'Arrêt 2 (Twin Center) $\rightarrow$ confirmation de dépose et notification d'arrivée.
8. Clôture de la tournée et affichage du bilan de conformité CNDP.
