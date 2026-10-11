import type { NextConfig } from "next";

import { devHostError } from "./lib/share-origin/share-origin";

// Refuse a NEXT_PUBLIC_DEV_HOST that can't go in a URL, here at startup: it is baked into the client bundle and only
// ever seen inside a QR code, so a bad value would reach a player's phone as an unopenable link.
const devHostProblem = devHostError(process.env.NEXT_PUBLIC_DEV_HOST);
if (devHostProblem) throw new Error(devHostProblem);

// Proxy the api and socket through Next so the browser sees one origin (cookie + no CORS), in dev and in prod.
const api = process.env.API_ORIGIN ?? "http://localhost:4000";

// Dev only: phones and tablets open the app at the machine's LAN address, which the dev server refuses unless it is
// listed here (comma separated hosts, e.g. `DEV_ORIGINS=192.168.1.86`).
const devOrigins = process.env.DEV_ORIGINS?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  transpilePackages: ["@inconsistable/auth", "@inconsistable/core-schema"],
  ...(devOrigins?.length ? { allowedDevOrigins: devOrigins } : {}),
  output: "standalone",
  skipTrailingSlashRedirect: true, // socket.io's path is "/socket.io/"; Next's slash-stripping 308 would break it
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/socket.io/", destination: `${api}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${api}/socket.io/:path*` },
    ];
  },
};

export default nextConfig;
