import { cookies, headers as requestHeaders } from "next/headers";

import { DEVICE_COOKIE, SESSION_COOKIE } from "@inconsistable/auth/api";

import { API_ORIGIN, TOKEN_COOKIE } from "@/app/constants";

// GET an api route as the caller, from the server: their session, device and guest cookies (all httpOnly, so only the
// server can forward them). Plus the caller's IP, which the api rate-limits by.
export async function apiGet(path: string) {
  const jar = await cookies();
  const ip = (await requestHeaders()).get("cf-connecting-ip");
  const headers: Record<string, string> = {};
  if (ip) headers["cf-connecting-ip"] = ip;
  const sent = [SESSION_COOKIE, DEVICE_COOKIE, TOKEN_COOKIE]
    .map((name) => [name, jar.get(name)?.value] as const)
    .filter((c): c is readonly [string, string] => !!c[1])
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`);
  if (sent.length) headers.cookie = sent.join("; ");
  const res = await fetch(`${API_ORIGIN}${path}`, { headers, cache: "no-store" });
  return res;
}
