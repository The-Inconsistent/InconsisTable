type Headers = Record<string, string | string[] | undefined>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// The identity provider calls it server to server, with no cookie; the logout token is its proof (§7.6).
export const CSRF_EXEMPT = new Set(["/api/auth/backchannel-logout"]);

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// docs/research/auth-service-security.md §7.5: a write needs Sec-Fetch-Site: same-origin, or, from a client that sends
// no Fetch Metadata, an Origin among WEB_ORIGIN. `same-site` is not enough: auth.<domain> and app2.<domain> share a
// site. A non-browser client can send these headers, but it carries no victim's cookies, which is what CSRF abuses.
export function crossSiteWrite({
  method,
  path,
  headers,
  webOrigins,
}: {
  method: string;
  path: string;
  headers: Headers;
  webOrigins: readonly string[];
}): boolean {
  if (SAFE_METHODS.has(method) || CSRF_EXEMPT.has(path)) return false;
  const site = one(headers["sec-fetch-site"]);
  if (site !== undefined) return site !== "same-origin";
  const origin = one(headers.origin);
  return origin === undefined || !webOrigins.includes(origin);
}

// WEB_ORIGIN may list several origins (localhost and the LAN address), comma separated, as for the socket's CORS.
export const webOrigins = (value: string | undefined) =>
  value
    ?.split(",")
    .map((o) => o.trim())
    .filter(Boolean) ?? [];
