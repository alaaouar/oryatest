"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { clearTokens, ensureCsrf, logout as apiLogout, me as fetchMe } from "./api";
import { purgeOfflineData } from "./offline-attendance";
import type { MeResponse } from "./types";

type SessionValue = {
  me: MeResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

/**
 * ADR-003 (t89) : copie du profil par onglet (sessionStorage, aucun jeton) pour que l'écran
 * d'appel se recharge sans réseau. Utilisée uniquement sur erreur réseau ; effacée par clearTokens.
 */
const ME_OFFLINE_KEY = "orya.me.offline";

function readOfflineMe(): MeResponse | null {
  try {
    const raw = window.sessionStorage.getItem(ME_OFFLINE_KEY);
    return raw ? (JSON.parse(raw) as MeResponse) : null;
  } catch {
    return null;
  }
}

/**
 * Session de la console : garde d'accès côté client, rechargement du profil,
 * déconnexion. Aucun jeton n'est lu côté serveur : la console est un client.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // B07 : un onglet sans jeton CSRF mais avec une session cookie valide la reprend.
    if (!(await ensureCsrf())) {
      setMe(null);
      setLoading(false);
      router.replace("/login");
      return;
    }

    try {
      const data = await fetchMe();
      setMe(data);
      setError(null);
      window.sessionStorage.setItem(ME_OFFLINE_KEY, JSON.stringify(data));
    } catch (cause) {
      // Réseau absent (TypeError) : la session cookie n'est pas remise en cause, profil de l'onglet.
      const offline = cause instanceof TypeError ? readOfflineMe() : null;
      if (offline) {
        setMe(offline);
        setError(null);
      } else {
        setError(cause instanceof Error ? cause.message : "Session invalide.");
        clearTokens();
        setMe(null);
        router.replace("/login");
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Une session déjà expirée ne doit pas bloquer la déconnexion.
    }
    clearTokens();
    await purgeOfflineData().catch(() => undefined);
    setMe(null);
    router.replace("/login");
  }, [router]);

  return (
    <SessionContext.Provider value={{ me, loading, error, reload, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession doit être utilisé dans SessionProvider.");
  }
  return context;
}

export function useActiveProfile() {
  const { me } = useSession();
  return me?.profiles.find((profile) => profile.id === me.activeProfileId) ?? null;
}
