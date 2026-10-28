# The identity provider renders its own pages instead of a Next.js UI

Status: accepted (amends ADR 0005)

## Context

ADR 0005 gives the identity provider "its own Next.js UI for sign-in, passkeys, recovery codes and account
management". The UI is a handful of pages: sign in, register a passkey, show recovery codes, enter a recovery code,
confirm logout, error, account, and the admin enrolment ticket. The security review
(`docs/research/auth-service-security.md` §2.1, §4) asks for three things that Next.js makes harder:

- A small dependency tree in the process that holds the signing keys and the credential tables.
- A strict CSP with a fresh nonce per response and Trusted Types. Next.js needs dynamic rendering for nonces, and
  React does not run under `trusted-types 'none'`.
- Interaction routes that read state through `provider.interactionDetails(req, res)`. That call needs Node's request
  and response objects, which App Router handlers do not expose. It would need a custom server or a second container.

## Decision

The identity provider serves its pages itself, as server-rendered HTML from the same Node process that runs
`oidc-provider`. One same-origin script, `passkey.js`, runs the WebAuthn ceremonies with the browser's native JSON
helpers and posts the result with `fetch`. The server answers with the redirect target and the page navigates there.
There is no frontend framework, no CDN, no inline handler, and no `innerHTML`.

## Considered options

- Next.js 16 as written in ADR 0005: shared components and look with the InconsisTable web app, at the cost of the
  three points above.
- Next.js as a second container on the same host, calling the identity provider over an internal API: keeps React,
  but adds a service, an internal API to secure, and a hop on every interaction.

## Consequences

- The identity provider's dependency tree stays at `oidc-provider`, `@simplewebauthn/server`, `pg`, `drizzle-orm`,
  `jose` and `zod`.
- The CSP of §4.2 applies as written, Trusted Types included.
- The pages do not share components with the InconsisTable web app. Their look is kept consistent by hand.
- Browsers without `PublicKeyCredential.parseCreationOptionsFromJSON` cannot use a passkey on the identity provider.
- House decision #33 changes "with its own Next.js UI" to "with its own server-rendered pages (ADR 0006)".
