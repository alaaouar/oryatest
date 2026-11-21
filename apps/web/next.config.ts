import type { NextConfig } from "next";

/**
 * La console appelle l'API en cross-origin ; le CORS est configuré côté API
 * (variable CORS_ORIGINS). La cible long terme reste un BFF Next avec cookies
 * httpOnly (voir docs/plan-lot1.md).
 *
 * Lot 2.3 : en-têtes de sécurité, dont une Content-Security-Policy qui limite
 * les connexions sortantes à l'origine de l'API (réduit l'exfiltration de
 * jetons en cas de XSS) et interdit l'intégration en iframe.
 */
const isDev = process.env.NODE_ENV !== "production";

function apiOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3200/api/v1").origin;
  } catch {
    return "http://localhost:3200";
  }
}

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js injecte des scripts inline d'hydratation ; 'unsafe-eval' seulement en dev (HMR).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://tile.openstreetmap.org",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin()}${isDev ? " ws: wss:" : ""} https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://nominatim.openstreetmap.org`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  experimental: {
    agentUpgrade: "security",
  },
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
