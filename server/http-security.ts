import helmet from "helmet";
import type express from "express";

// Baseline response headers for every request, public or local.
//
// The public landing page loads three.js + vanta from CDNs (apps/web/index.html),
// so script-src can't be 'self' alone — those two hosts are allowlisted
// explicitly rather than opening the directive up with 'unsafe-inline'.
// img-src allows arbitrary https hosts because Composio serves toolkit logos
// from its own CDN and the connection cards render them directly.
// connect-src stays 'self': the dashboard talks only to same-origin /api/*.
export function applySecurityHeaders(app: express.Express) {
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https:"],
          "font-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
        },
      },
      // includeSubDomains is deliberately off. Browsers cache HSTS for the full
      // max-age, so opting in every present and future subdomain is painful to
      // walk back if one ever needs plain HTTP. Turn it on once every subdomain
      // is known to terminate TLS.
      hsts: { maxAge: 15552000, includeSubDomains: false, preload: false },
      // Matches frame-ancestors 'none' above, for browsers predating CSP2.
      frameguard: { action: "deny" },
      // COEP would block the two CDN scripts the landing page depends on.
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
}
