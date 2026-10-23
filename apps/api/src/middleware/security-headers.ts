import { createMiddleware } from 'hono/factory';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: https:",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Security headers for every API response. The static app gets the same set from vercel.json. */
export function securityHeaders() {
  return createMiddleware(async (c, next) => {
    await next();
    c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
  });
}
