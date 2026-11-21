import { Injectable, type MessageEvent } from "@nestjs/common";
import { Observable, Subject, map, merge, of } from "rxjs";

export type TripLivePayload = {
  tripId: string;
  type: "position" | "stop_event" | "trip_status";
  latitude?: number;
  longitude?: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  recordedAt: string;
  stopId?: string;
  eventType?: string;
  status?: string;
  etaByStop?: Record<string, { etaMinutes: number; distanceMeters: number }>;
};

@Injectable()
export class TransportRealtimeService {
  private readonly tripSubjects = new Map<string, Subject<TripLivePayload>>();
  private readonly schoolSubjects = new Map<string, Subject<TripLivePayload>>();

  private getOrCreateTripSubject(tripId: string): Subject<TripLivePayload> {
    let subject = this.tripSubjects.get(tripId);
    if (!subject) {
      subject = new Subject<TripLivePayload>();
      this.tripSubjects.set(tripId, subject);
    }
    return subject;
  }

  private getOrCreateSchoolSubject(schoolId: string): Subject<TripLivePayload> {
    let subject = this.schoolSubjects.get(schoolId);
    if (!subject) {
      subject = new Subject<TripLivePayload>();
      this.schoolSubjects.set(schoolId, subject);
    }
    return subject;
  }

  /**
   * Émet une mise à jour temps réel pour une tournée donnée et pour la vue école.
   */
  broadcastTripUpdate(schoolId: string, payload: TripLivePayload): void {
    const tripSubject = this.tripSubjects.get(payload.tripId);
    if (tripSubject) {
      tripSubject.next(payload);
    }

    const schoolSubject = this.schoolSubjects.get(schoolId);
    if (schoolSubject) {
      schoolSubject.next(payload);
    }
  }

  /**
   * Fournit le flux SSE pour un trajet spécifique (destiné aux parents et au chauffeur).
   */
  getTripStream(tripId: string, initialPayload?: TripLivePayload | null): Observable<MessageEvent> {
    const subject = this.getOrCreateTripSubject(tripId);
    const initial$ = initialPayload
      ? of(initialPayload).pipe(
          map(
            (data) =>
              ({
                data,
                id: `${Date.now()}-init`,
                type: "transport_update",
                retry: 3000,
              }) as MessageEvent,
          ),
        )
      : of();

    const updates$ = subject.asObservable().pipe(
      map(
        (data) =>
          ({
            data,
            id: `${Date.now()}`,
            type: "transport_update",
            retry: 3000,
          }) as MessageEvent,
      ),
    );

    return merge(initial$, updates$);
  }

  /**
   * Fournit le flux SSE pour l'ensemble de la flotte de l'école (vue direction).
   */
  getSchoolStream(schoolId: string): Observable<MessageEvent> {
    const subject = this.getOrCreateSchoolSubject(schoolId);
    return subject.asObservable().pipe(
      map(
        (data) =>
          ({
            data,
            id: `${Date.now()}`,
            type: "fleet_update",
            retry: 5000,
          }) as MessageEvent,
      ),
    );
  }

  /**
   * Nettoie les canaux d'une tournée terminée pour libérer la mémoire.
   */
  closeTripStream(tripId: string): void {
    const subject = this.tripSubjects.get(tripId);
    if (subject) {
      subject.complete();
      this.tripSubjects.delete(tripId);
    }
  }
}
