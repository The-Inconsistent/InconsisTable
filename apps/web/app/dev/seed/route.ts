import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";

import { DEVICE_COOKIE, isDeviceSecret } from "@inconsistable/auth/api";

const YEAR_S = 365 * 24 * 3600;

// Dev only: makes this browser the sample GM that `bun run seed` made, by its device secret in `.seed-device` at the
// repo root (never committed). Answers 404 outside `next dev` and when there is no seed.
// ponytail: a local door into one made-up identity, upgrade: drop it once a sign-in provider exists
export function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  let secret = "";
  try {
    secret = readFileSync(path.join(process.cwd(), "../../.seed-device"), "utf8").trim();
  } catch {
    // no seed yet: same answer as a malformed one
  }
  if (!isDeviceSecret(secret)) return new NextResponse(null, { status: 404 });
  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.set(DEVICE_COOKIE, secret, { httpOnly: true, sameSite: "lax", maxAge: YEAR_S, path: "/" });
  return res;
}
