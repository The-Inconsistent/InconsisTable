import { index, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { PlatformRole } from "@inconsistable/auth/api";
import { createdAt } from "../core/sql.ts";
import { appUser } from "./auth.schema.ts";

// Signing in through the identity provider (docs/research/auth-service-security.md §7). Like every other secret here,
// a handle or a session token is stored only as its SHA-256.

// A sign-in in flight, between POST /api/auth/login and the callback: single use (deleted on first read) and bound to
// the browser holding the handle cookie. `transaction` is the SDK's own document (state, nonce, PKCE verifier),
// read and written whole. Rows older than 10 minutes are dead and pruned at the next sign-in start.
export const oidcTx = pgTable("oidc_tx", {
  handleHash: text().primaryKey(),
  transaction: jsonb().notNull(),
  // The anonymous device user who started it. Kept for attaching a device's data to an account, which this slice
  // does not do: the device user stays untouched (ADR 0005).
  deviceUserId: text().references(() => appUser.id, { onDelete: "set null" }),
  returnTo: text().notNull(),
  createdAt: createdAt(),
});

// An account at an issuer is one app_user, and an app_user holds at most one account per issuer (§7.3).
export const identityLink = pgTable(
  "identity_link",
  {
    iss: text().notNull(),
    sub: text().notNull(),
    userId: text()
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.iss, t.sub] }), unique().on(t.userId, t.iss)],
);

// The api's own session after a sign-in (§7.4): 30 days idle (last_seen_at), 90 days at most (expires_at), house
// decision #33. `op_sid` is the identity provider's session, which a back-channel logout names. `roles` are the ID
// token's platform roles at sign-in; a role change at the provider ends the session, so they never go stale.
export const apiSession = pgTable(
  "api_session",
  {
    tokenHash: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    opSid: text().notNull(),
    roles: text().array().$type<PlatformRole[]>().notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index().on(t.opSid), index().on(t.userId)],
);

// Logout tokens already acted on, so a replayed one is refused (Back-Channel Logout 1.0 §2.6). Pruned past `exp`.
export const logoutJti = pgTable("logout_jti", {
  jti: text().primaryKey(),
  exp: timestamp({ withTimezone: true }).notNull(),
});

// House decision #33: a session ends 30 days after it was last used, and 90 days after sign-in at the latest.
export const SESSION_IDLE_MS = 30 * 24 * 3600 * 1000;
export const SESSION_MAX_MS = 90 * 24 * 3600 * 1000;
