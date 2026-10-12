import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as actorSchema from "../actor/actor.schema.ts";
import * as adminSchema from "../admin/admin.schema.ts";
import * as authSchema from "../auth/auth.schema.ts";
import * as campaignSchema from "../campaign/campaign.schema.ts";
import * as codexSchema from "../codex/codex.schema.ts";
import * as rulesetSchema from "../ruleset/ruleset.schema.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const schema = {
  ...actorSchema,
  ...adminSchema,
  ...authSchema,
  ...campaignSchema,
  ...codexSchema,
  ...rulesetSchema,
};

// Postgres 18 (uuidv7, RETURNING OLD/NEW). Dev runs it in Docker (docker-compose.yml).
export const db = drizzle(process.env.DATABASE_URL, { schema, casing: "snake_case" });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Either the pool or an open transaction: for reads that also run inside actions.
export type Db = typeof db | Tx;

export const runMigrations = () =>
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
