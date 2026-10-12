import type { MemberRole } from "@inconsistable/core-schema";

// A seat's role as the table reads it (lobby cards, invites, PARTY).
export const ROLE_LABEL: Record<MemberRole, string> = { gm: "GM", cogm: "Co-GM", player: "Player" };

// Server-side only: where Next reaches the api directly (the browser goes through the rewrites in next.config.ts).
export const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

// The httpOnly guest cookie the api sets on /api/join and guest invites (COOKIE in apps/api/src/auth/auth.service.ts).
export const TOKEN_COOKIE = "it_token";

// Why /join/<token> bounced the caller back home, keyed by the `?join=` value.
export const JOIN_ERRORS = {
  invalid: "Link invalid or revoked. Ask your GM for a new QR code.",
  nosignal: "No signal. Check the connection and retry.",
} as const;
export type JoinError = keyof typeof JOIN_ERRORS;

export const NO_ACCESS = "No access. Ask your GM for an invite.";
