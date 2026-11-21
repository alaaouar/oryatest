/*
 * ORYA - service worker de l'appel hors ligne (ADR-003, t89).
 * Portee /attendance. Met en cache la coquille de l'ecran d'appel et ses ressources
 * statiques de meme origine (reseau d'abord, cache en secours). Ne touche jamais aux
 * appels d'API : autre origine, ou chemin /api/ ; aucune requete autre que GET.
 */
const CACHE = "orya-attendance-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith("orya-attendance-shell-") && key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (!url.pathname.startsWith("/_next/") && !url.pathname.startsWith("/attendance")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        if (response.ok && response.type === "basic") {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const hit = await cache.match(request, { ignoreVary: true });
        if (hit) return hit;
        if (request.mode === "navigate") {
          const shell = await cache.match(url.pathname, { ignoreSearch: true, ignoreVary: true });
          if (shell) return shell;
        }
        throw error;
      }
    })(),
  );
});
