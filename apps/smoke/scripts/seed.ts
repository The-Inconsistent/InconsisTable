// The local sample data: a GM with rooms, players, characters, two rulesets and a pack, all made through the api like
// any client (one mutation path, every check applies). Everything in it is the engine's own made-up test fixtures: no
// game content (CLAUDE.md). Idempotent: a room that exists by name is left alone, an import that is unchanged stays.
//
// Run against a running api: `bun run seed`. Then open http://localhost:3000/dev/seed in a browser to become the
// sample GM; its device secret is kept in `.seed-device` at the repo root (never committed).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { io } from "socket.io-client";
import { DEVICE_COOKIE, deviceSecret, isDeviceSecret } from "@inconsistable/auth/api";
import { Lobby, type ActionInput, type ActionResult } from "@inconsistable/core-schema";
import { SAMPLE_D20 } from "../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_PACK } from "../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { SAMPLE_POOL } from "../../../packages/rules-engine/src/fixtures/sample-pool.ts";

const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const SECRET_FILE = new URL("../../../.seed-device", import.meta.url);
const DAY_MS = 24 * 3600 * 1000;

// One REST call as a device; a refusal stops the seed with what the api said.
async function call({ method, path, body, cookie }: { method: string; path: string; body?: unknown; cookie: string }) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    // the api refuses a write without Fetch Metadata (core/csrf.ts); this script is the same-origin client it trusts
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json as Record<string, unknown>;
}

// A person: a device cookie, its user made on first sight and given a name.
async function person({ secret = deviceSecret(), name }: { secret?: string; name: string }) {
  const cookie = `${DEVICE_COOKIE}=${secret}`;
  await call({ method: "PATCH", path: "/me", body: { name }, cookie });
  return cookie;
}

// A seat at one table over the socket, for the actions only the table takes.
async function table({ campaignId, cookie }: { campaignId: string; cookie: string }) {
  const socket = io(API, {
    auth: { campaignId },
    extraHeaders: { cookie },
    transports: ["websocket"],
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    socket.once("state", resolve);
    socket.once("connect_error", reject);
  });
  const send = async (action: ActionInput) => {
    const result = (await socket.emitWithAck("action", action)) as ActionResult;
    if (!result.ok) throw new Error(`${action.type}: ${JSON.stringify(result)}`);
    return result;
  };
  return { send, close: () => socket.close() };
}

// A room owned by `owner`, with players who each accept one room invite with a new character.
async function room({
  owner,
  name,
  rulesetVersionId,
  players = [],
  setup,
}: {
  owner: string;
  name: string;
  rulesetVersionId?: string;
  players?: { cookie: string; character: string }[];
  setup?: (send: (a: ActionInput) => Promise<ActionResult>) => Promise<void>;
}) {
  const { campaignId } = (await call({
    method: "POST",
    path: "/campaigns",
    body: { name, rulesetVersionId },
    cookie: owner,
  })) as { campaignId: string };
  const gm = await table({ campaignId, cookie: owner });
  if (players.length) {
    const { token } = await gm.send({ type: "invite.create", mode: "room", role: "player" });
    for (const p of players)
      await call({
        method: "POST",
        path: `/invites/${token}/accept`,
        body: { newCharacterName: p.character },
        cookie: p.cookie,
      });
  }
  await setup?.(gm.send);
  gm.close();
  console.log(`  + ${name}`);
}

const saved = existsSync(SECRET_FILE) ? readFileSync(SECRET_FILE, "utf8").trim() : "";
const gmSecret = isDeviceSecret(saved) ? saved : deviceSecret();
writeFileSync(SECRET_FILE, `${gmSecret}\n`);
const gm = await person({ secret: gmSecret, name: "Sample GM" });

const d20 = await call({ method: "POST", path: "/rulesets", body: SAMPLE_D20, cookie: gm });
const pool = await call({ method: "POST", path: "/rulesets", body: SAMPLE_POOL, cookie: gm });
const pack = await call({ method: "POST", path: "/packs", body: SAMPLE_PACK, cookie: gm });
console.log(
  `rulesets ${d20.slug} ${d20.version}, ${pool.slug} ${pool.version}; pack ${SAMPLE_PACK.id} ${pack.version}`,
);

const lobby = Lobby.parse(await call({ method: "GET", path: "/lobby", cookie: gm }));
const have = [...lobby.mine, ...lobby.seated, ...lobby.archived];
// A room counts only while it runs the version just imported: one left on an older sample is replaced by a fresh room
// beside it. An old manifest the engine now refuses makes the rules read fail, which counts as stale too.
async function missing(name: string, versionId?: unknown) {
  for (const g of have.filter((g) => g.name === name)) {
    if (versionId === undefined) return false;
    try {
      const rules = (await call({ method: "GET", path: `/campaigns/${g.id}/rules`, cookie: gm })) as {
        ruleset: { versionId: string } | null;
      };
      if (rules.ruleset?.versionId === versionId) return false;
    } catch {
      // stale: look at the next room of that name
    }
  }
  return true;
}

if (await missing("Crypt of Ash", d20.versionId))
  await room({
    owner: gm,
    name: "Crypt of Ash",
    rulesetVersionId: d20.versionId as string,
    players: [
      { cookie: await person({ name: "Ana" }), character: "Mira" },
      { cookie: await person({ name: "Ben" }), character: "Tobin" },
    ],
    setup: async (send) => {
      await send({ type: "campaign.attachPack", packVersionId: pack.versionId as string });
      await send({ type: "actor.create", kind: "npc", name: "Sexton Hale" });
      await send({ type: "campaign.update", nextSessionAt: new Date(Date.now() + 3 * DAY_MS).toISOString() });
      await send({ type: "session.start", title: "The sealed door" });
    },
  });
if (await missing("Sunday table", pool.versionId))
  await room({
    owner: gm,
    name: "Sunday table",
    rulesetVersionId: pool.versionId as string,
    players: [{ cookie: await person({ name: "Cleo" }), character: "Iris" }],
    setup: async (send) => {
      await send({ type: "campaign.update", nextSessionAt: new Date(Date.now() + 6 * DAY_MS).toISOString() });
    },
  });
if (await missing("Old one-shot", d20.versionId))
  await room({
    owner: gm,
    name: "Old one-shot",
    rulesetVersionId: d20.versionId as string,
    setup: async (send) => {
      await send({ type: "campaign.archive" });
    },
  });
// A table someone else runs, where the sample GM plays: fills "Where you play" and the Characters page.
if (await missing("Lantern Keep"))
  await room({
    owner: await person({ name: "Rook" }),
    name: "Lantern Keep",
    players: [{ cookie: gm, character: "Wren" }],
  });

console.log(`done. Open http://localhost:3000/dev/seed to become the sample GM.`);
