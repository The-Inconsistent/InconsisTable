import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as actorSchema from "../actor/actor.schema.ts";
import * as adminSchema from "../admin/admin.schema.ts";
import * as authSchema from "../auth/auth.schema.ts";
import * as campaignSchema from "../campaign/campaign.schema.ts";
import * as codexSchema from "../codex/codex.schema.ts";
import * as packSchema from "../pack/pack.schema.ts";
import * as rulesetSchema from "../ruleset/ruleset.schema.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const schema = {
  ...actorSchema,
  ...adminSchema,
  ...authSchema,
  ...campaignSchema,
  ...codexSchema,
  ...packSchema,
  ...rulesetSchema,
};

// Postgres 18 (uuidv7, RETURNING OLD/NEW). Dev runs it in Docker (docker-compose.yml).
export const db = drizzle(process.env.DATABASE_URL, { schema, casing: "snake_case" });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
// Either the pool or an open transaction: for reads that also run inside actions.
export type Db = typeof db | Tx;

export async function runMigrations() {
  // pack_entry's name index uses pg_trgm. Enabled here, not in a migration file, so regenerating the migration
  // from scratch (CLAUDE.md) can't lose it. A trusted extension: the database owner may create it.
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
}
