import { test } from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "./seat.ts";
import type { Actor, Codex, CodexEntry, LiveState } from "./state.ts";
import { toSeatCodex, toSeatState } from "./view.ts";

const ctx = (seat: Ctx["seat"]): Ctx => ({ campaignId: "c1", userId: "u", campaignOwnerId: "owner", seat });
const gm = ctx({ kind: "member", role: "gm", scopes: [], characterIds: [] });
const coCodex = ctx({ kind: "member", role: "cogm", scopes: ["codex"], characterIds: [] });
const lyra = ctx({ kind: "member", role: "player", scopes: [], characterIds: ["lyra"] });
const bran = ctx({ kind: "token", role: "player", characterIds: ["bran"] });
const screen = ctx({ kind: "token", role: "screen", characterIds: [] });

const entry = (over: Partial<CodexEntry>): CodexEntry => ({
  id: "e",
  kind: "handout",
  title: "T",
  body: "B",
  gmNotes: "secret",
  visibility: "party",
  audienceMode: "all",
  audience: [],
  ...over,
});
const codex: Codex = {
  entries: [
    entry({ id: "hidden", visibility: "gm" }),
    entry({ id: "open" }),
    entry({ id: "for-lyra", audienceMode: "listed", audience: ["lyra", "kael"] }),
  ],
};
const ids = (c: Codex) => c.entries.map((e) => e.id);

test("GM seats see every entry with notes; a codex co-GM sees every entry without notes", () => {
  assert.deepEqual(ids(toSeatCodex({ codex, ctx: gm })), ["hidden", "open", "for-lyra"]);
  assert.equal(toSeatCodex({ codex, ctx: gm }).entries[0]?.gmNotes, "secret");
  const co = toSeatCodex({ codex, ctx: coCodex });
  assert.deepEqual(ids(co), ["hidden", "open", "for-lyra"]);
  assert.ok(co.entries.every((e) => e.gmNotes === ""));
});

test("players see revealed entries, listed ones only when they hold a listed character", () => {
  assert.deepEqual(ids(toSeatCodex({ codex, ctx: lyra })), ["open", "for-lyra"]);
  assert.deepEqual(ids(toSeatCodex({ codex, ctx: bran })), ["open"]);
  assert.deepEqual(ids(toSeatCodex({ codex, ctx: screen })), ["open"]);
  const forLyra = toSeatCodex({ codex, ctx: lyra }).entries.find((e) => e.id === "for-lyra");
  assert.deepEqual(forLyra?.audience, ["lyra"]); // never who else it was shown to
  assert.ok(toSeatCodex({ codex, ctx: lyra }).entries.every((e) => e.gmNotes === ""));
});

test("seats outside the GM side get no invites and no session notes", () => {
  const state: LiveState = {
    campaign: { id: "c1", name: "R", ownerUserId: "owner", archived: false, nextSessionAt: null, nextSessionPlace: "" },
    stateVersion: 3,
    session: { id: "s", number: 1, title: "", startedAt: "", endedAt: null, recap: "", notes: "gm only" },
    actors: [],
    tests: [],
    testDefs: [],
    access: {
      members: [],
      invites: [
        {
          id: "i",
          mode: "room",
          role: "player",
          actorId: null,
          allowGuests: true,
          expiresAt: "",
          uses: 0,
          maxUses: null,
        },
      ],
      guests: [],
      screens: 0,
      transfer: null,
    },
  };
  for (const c of [lyra, bran, screen]) {
    const v = toSeatState({ state, ctx: c });
    assert.deepEqual(v.access.invites, []);
    assert.equal(v.session?.notes, "");
  }
  assert.equal(toSeatState({ state, ctx: gm }).access.invites.length, 1);
});

test("seats outside the party/combat side see the party and their own characters, owners only on their own", () => {
  const actor = (id: string, kind: Actor["kind"]): Actor => ({
    id,
    kind,
    name: id,
    status: "active",
    ownerUserId: "x",
    entity: "",
    fields: {},
    resources: {},
    derived: {},
    conditions: [],
  });
  const state: LiveState = {
    campaign: { id: "c1", name: "R", ownerUserId: "owner", archived: false, nextSessionAt: null, nextSessionPlace: "" },
    stateVersion: 1,
    session: null,
    actors: [actor("lyra", "pc"), actor("bran", "pc"), actor("cat", "companion"), actor("ogre", "creature")],
    tests: [],
    testDefs: [],
    access: { members: [], invites: [], guests: [], screens: 0, transfer: null },
  };
  const view = (c: Ctx) => toSeatState({ state, ctx: c }).actors;
  for (const c of [lyra, bran, screen, coCodex])
    assert.deepEqual(
      view(c).map((a) => a.id),
      ["lyra", "bran", "cat"],
    );
  assert.deepEqual(
    view(lyra).map((a) => a.ownerUserId),
    ["x", null, null],
  );
  assert.ok(view(screen).every((a) => a.ownerUserId === null));
  const coParty = ctx({ kind: "member", role: "cogm", scopes: ["party"], characterIds: [] });
  const coCombat = ctx({ kind: "member", role: "cogm", scopes: ["combat"], characterIds: [] });
  for (const c of [gm, coParty, coCombat]) assert.deepEqual(view(c), state.actors);
  // A seat holding an NPC sees it.
  const npcHolder = ctx({ kind: "token", role: "player", characterIds: ["ogre"] });
  assert.ok(view(npcHolder).some((a) => a.id === "ogre" && a.ownerUserId === "x"));
});
