// Aspire TypeScript AppHost: Postgres 18 → api → web, with a dashboard (logs, traces, health-gated startup).
// For more information, see: https://aspire.dev

import { createBuilder } from "./.aspire/modules/aspire.mjs";

const builder = await createBuilder();

// Credentials, database and port match docker-compose.yml, so apps/api/.env and drizzle-kit keep working against
// this container without a second DATABASE_URL.
const userName = await builder.addParameter("pg-user", { value: "it" });
const password = await builder.addParameter("pg-password", { value: "it", secret: true });

// Postgres 18, as everywhere (CLAUDE.md): uuidv7() and RETURNING OLD/NEW need it. A data volume from another major
// can't be read, so changing this tag means recreating the volume.
const postgres = await builder.addPostgres("postgres", { port: 5435, userName, password });
await postgres.withImageTag("18");
await postgres.withDataVolume();
const db = await postgres.addDatabase("it");

// install: false — this is a Bun workspace; `workspace:*` deps only resolve from a root `bun install`, so a per-app
// install hangs. The root install already populates node_modules.
const api = await builder.addJavaScriptApp("api", "../apps/api", { runScriptName: "dev" });
await api.withBun({ install: false });
await api.withHttpEndpoint({ port: 4000, env: "PORT" });
await api.withEnvironment("DATABASE_URL", await db.uriExpression());
await api.waitFor(db);

// Port pinned to 3000: Next's rewrites and WEB_ORIGIN assume it. isProxied: false so Next
// itself binds 3000 (on every interface) instead of DCP proxying it — phones and tablets at the table need the LAN
// address.
const web = await builder.addNextJsApp("web", "../apps/web", { runScriptName: "dev" });
await web.withBun({ install: false });
await web.withHttpEndpoint({ port: 3000, targetPort: 3000, env: "PORT", isProxied: false });
await web.waitFor(api);

await builder.build().run();
