/** Most keys one limiter holds; past it a new key is refused (fail closed) until the windows expire. */
export const MAX_LIMITER_KEYS = 10_000;

// ponytail: in-process fixed windows, assumes one api instance; Redis or pg counters if we ever scale out
export function limiter({ max, windowMs }: { max: number; windowMs: number }) {
  const hits = new Map<string, { n: number; reset: number }>();
  let swept = 0;
  return (key: string): boolean => {
    const now = Date.now();
    const h = hits.get(key);
    if (h && now < h.reset) return ++h.n <= max;
    // Bounded memory: drop expired windows, at most once per window; still full means a flood, so refuse the new key.
    if (hits.size >= MAX_LIMITER_KEYS) {
      if (now - swept >= windowMs) {
        swept = now;
        for (const [k, v] of hits) if (now >= v.reset) hits.delete(k);
      }
      if (hits.size >= MAX_LIMITER_KEYS) return false;
    }
    hits.set(key, { n: 1, reset: now + windowMs });
    return true;
  };
}

// The caller's IP. Behind Cloudflare → Pangolin → Next every hop hides it from the api, but Cloudflare overwrites
// CF-Connecting-IP on each proxied request and Next's rewrites pass it through; Next's own server-side fetches forward
// it (apps/web/app/server-api.ts, join/[token]/route.ts). Any client can send that header, so it is trusted only when
// TRUST_CF=1 (set it only behind Cloudflare); otherwise (dev, bare deploy) the socket's peer.
// ponytail: forgeable by a client that bypasses Cloudflare to hit Pangolin directly; allow only Cloudflare IPs there
export function clientIp(headers: Record<string, string | string[] | undefined>, fallback: string | undefined) {
  const cf = process.env.TRUST_CF === "1" ? headers["cf-connecting-ip"] : undefined;
  return (Array.isArray(cf) ? cf[0] : cf) ?? fallback ?? "unknown";
}
