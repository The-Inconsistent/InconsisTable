# Accounts come from our own OIDC identity provider, built on `oidc-provider`

Status: accepted

## Context

There are no accounts yet: every browser is an anonymous `app_user` named by the `it_device` cookie, and admin is the
shared `ADMIN_KEY` (house decision #32). A second app will need the same sign-in, so sign-in must be single sign-on.
Cost rules out paid providers, and the user store must stay ours (`docs/research/auth-providers.md`,
`docs/research/self-built-auth.md` §8).

## Decision

A separate service, `apps/auth`, is an OpenID Provider built on `oidc-provider` and run on Node 22 LTS. It runs at
`auth.<domain>` and keeps its accounts, passkeys, recovery codes, grants and signing keys in its own database
(`it_auth`, own role) on the same Postgres 18 server. The api is a confidential OIDC client: it exchanges the code,
links (`iss`, `sub`) to an `app_user`, and issues its own opaque session cookie, so REST and the socket keep reading one
session table. The token carries only platform roles (`admin`, `creator`); seats and `canInCampaign` stay in the api.
Sign-in is a passkey plus single-use recovery codes, with no email. Accounts exist only on HTTPS deployments; on plain
HTTP over a LAN, sign-in is off and the app stays anonymous.

## Considered options

- An `auth/` module inside the api: cheapest, but cannot give a second app single sign-on.
- Better Auth as the IdP: least code and runs on Bun, but its OAuth Provider plugin is new, not certified, and had
  advisories in 2026 on authorization-code reuse, refresh-token races, audience and `javascript:` redirect URIs.
- Ory Hydra with a TypeScript login app: certified and company-backed, but one more container and a slowing release
  cadence. It is the fallback if `oidc-provider` loses its maintainer.
- Duende/OpenIddict (.NET), Spring Security or Keycloak (Java): mature, but add a language and toolchain.

## Consequences

- `apps/auth` is the one service that runs on Node, not Bun (house decision #34).
- `oidc-provider` has a single maintainer; the protocol core changes rarely, so a fork stays viable.
- Revocation is immediate for the api: back-channel logout deletes its sessions and kicks their sockets.
- Anonymous users stay in the api; signing in on a device that is already an anonymous user attaches the account to
  that user, or switches the device to the account's user and leaves the anonymous one untouched.
