import { NextResponse, type NextRequest } from "next/server";

import { DEVICE_COOKIE, deviceSecret, isDeviceSecret } from "@inconsistable/auth/api";

const YEAR_S = 365 * 24 * 3600;

// Gives every device its identity: no `it_device` cookie (or a malformed one) gets a fresh secret. It is also put on
// this very request, so the server components that render next read it. The api trusts a well-formed secret and makes
// the user on first sight. Nothing is blocked here.
// ponytail: a lost cookie is a lost identity, swap in a provider's session here
export default function proxy(req: NextRequest) {
  if (isDeviceSecret(req.cookies.get(DEVICE_COOKIE)?.value)) return NextResponse.next();
  const secret = deviceSecret();
  const kept = (req.headers.get("cookie") ?? "")
    .split(";")
    .filter((c) => c.trim() && !c.trim().startsWith(`${DEVICE_COOKIE}=`));
  const headers = new Headers(req.headers);
  headers.set("cookie", [...kept, `${DEVICE_COOKIE}=${secret}`].join(";"));
  const res = NextResponse.next({ request: { headers } });
  // Secure only over https (behind a TLS proxy, the forwarded protocol): a LAN address is plain http.
  const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.cookies.set(DEVICE_COOKIE, secret, { httpOnly: true, sameSite: "lax", secure: https, maxAge: YEAR_S, path: "/" });
  return res;
}

export const config = {
  matcher: [
    "/((?!_next|api/|socket\\.io|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|webmanifest)).*)",
  ],
};
