// Aspire TypeScript AppHost: Postgres 18 → api → web, with a dashboard (logs, traces, health-gated startup).
// For more information, see: https://aspire.dev

import { createBuilder } from "./.aspire/modules/aspire.mjs";

const builder = await createBuilder();

// Verification (.claude/skills/verify-inconsistable) runs a second stack beside the dev one: its own ports and no data
// volume, so every run starts from an empty database. Unset, these are the dev defaults.
const ports = {
  postgres: Number(process.env.IT_PG_PORT ?? 5435),
  api: Number(process.env.IT_API_PORT ?? 4000),
  web: Number(process.env.IT_WEB_PORT ?? 3000),
};
const ephemeral = process.env.IT_EPHEMERAL === "1";

// Credentials, database and port match docker-compose.yml, so apps/api-go/.env keeps working against this container
// without a second DATABASE_URL.
const userName = await builder.addParameter("pg-user", { value: "it" });
const password = await builder.addParameter("pg-password", { value: "it", secret: true });

// Postgres 18, as everywhere (CLAUDE.md): uuidv7() and RETURNING OLD/NEW need it. A data volume from another major
// can't be read, so changing this tag means recreating the volume.
const postgres = await builder.addPostgres("postgres", { port: ports.postgres, userName, password });
await postgres.withImageTag("18");
if (!ephemeral) await postgres.withDataVolume();
const db = await postgres.addDatabase("it");

// The Go api (apps/api-go), from source. Its first run downloads the private sign-in SDK: GOPRIVATE and a git that can
// read The-Inconsistent/InconsisID (docs/deploy.md). NODE_ENV=development keeps the guest cookie off Secure on http.
const api = await builder.addExecutable("api", "go", "../apps/api-go", ["run", "./cmd/api"]);
await api.withRequiredCommand("go");
await api.withHttpEndpoint({ port: ports.api, env: "PORT" });
await api.withEnvironment("DATABASE_URL", await db.uriExpression());
await api.withEnvironment("NODE_ENV", "development");
await api.withEnvironment("WEB_ORIGIN", `http://localhost:${ports.web}`);
if (process.env.ADMIN_KEY) await api.withEnvironment("ADMIN_KEY", process.env.ADMIN_KEY);
await api.waitFor(db);

// Port pinned (3000 in dev): WEB_ORIGIN above names it. isProxied: false so Next itself binds it (on every interface)
// instead of DCP proxying it — phones and tablets at the table need the LAN address.
const web = await builder.addNextJsApp("web", "../apps/web", { runScriptName: "dev" });
await web.withBun({ install: false });
await web.withHttpEndpoint({ port: ports.web, targetPort: ports.web, env: "PORT", isProxied: false });
await web.withEnvironment("API_ORIGIN", `http://localhost:${ports.api}`);
await web.waitFor(api);

await builder.build().run();
