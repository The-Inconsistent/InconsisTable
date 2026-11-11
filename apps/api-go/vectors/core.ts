// Writes what packages/core-schema answers, for internal/coreschema's tests to match (docs/adr/0008-go-api.md).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  canActOnMember,
  canGrantRole,
  canInCampaign,
  CreateGame,
  gmPermOf,
  Permission,
  refusalBody,
  REFUSALS,
  Rename,
  type Ctx,
  type Seat,
} from "../../../packages/core-schema/src/index.ts";

const OUT = join(import.meta.dirname, "../internal/coreschema/testdata/vectors.json");

const SEATS: Seat[] = [
  { kind: "admin" },
  { kind: "member", role: "gm", scopes: [], characterIds: [] },
  { kind: "member", role: "player", scopes: [], characterIds: ["held"] },
  { kind: "member", role: "player", scopes: [], characterIds: [] },
  { kind: "token", role: "player", characterIds: ["held"] },
  { kind: "token", role: "player", characterIds: [] },
  { kind: "token", role: "screen", characterIds: [] },
  ...[[], ["combat"], ["codex"], ["codex.secrets"], ["party"], ["session"], ["combat", "party"]].map(
    (scopes): Seat => ({ kind: "member", role: "cogm", scopes: scopes as ("combat" | "party")[], characterIds: [] }),
  ),
];
const PEOPLE: [string | null, string | null][] = [
  ["owner", "owner"],
  ["u1", "owner"],
  [null, "owner"],
  ["u1", null],
  [null, null],
];
const ROLES = ["gm", "cogm", "player"] as const;

const permissions = SEATS.flatMap((seat) =>
  PEOPLE.map(([userId, campaignOwnerId]) => {
    const ctx: Ctx = { campaignId: "c", userId, campaignOwnerId, seat };
    return {
      ctx,
      seatJson: seat,
      can: Object.fromEntries(Permission.options.map((perm) => [perm, canInCampaign({ ctx, perm })])),
      ownOk: Object.fromEntries(
        Permission.options.map((perm) => [perm, canInCampaign({ ctx, perm, target: { actorId: "held" } })]),
      ),
      actOn: {
        owner: canActOnMember({ ctx, target: { userId: "owner", role: "gm" } }),
        ...Object.fromEntries(ROLES.map((role) => [role, canActOnMember({ ctx, target: { userId: "u9", role } })])),
      },
      grant: Object.fromEntries(ROLES.map((role) => [role, canGrantRole({ ctx, role })])),
    };
  }),
);

const Join = z.object({ token: z.string().min(1).max(200) });
const UUID = "018f4d3a-7c1e-7a2b-9c3d-1a2b3c4d5e6f";
const ZOD_SHAPES: Record<string, z.ZodType> = {
  CampaignID: z.uuid(),
  CreateGame,
  AdminCreate: CreateGame.extend({ ownerUserId: z.string().min(1).max(100).optional() }),
  Rename,
  Join,
};
// prettier-ignore
const STRINGS = ["", " ", "  x  ", " x﻿", "x", "é", "😀", "x".repeat(40), "x".repeat(41), " " + "x".repeat(40) + " ", "x".repeat(100), "x".repeat(101), "x".repeat(200), "x".repeat(201), UUID, UUID.toUpperCase(), "00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff", "018f4d3a-7c1e-9a2b-9c3d-1a2b3c4d5e6f", "018f4d3a-7c1e-7a2b-1c3d-1a2b3c4d5e6f", "not-a-uuid"];
const JUNK: unknown[] = [undefined, null, 1, true, [], {}];
const shapes: unknown[] = [];
const record = (shape: string, input: unknown) => {
  const r = (ZOD_SHAPES[shape] as z.ZodType).safeParse(input);
  shapes.push({
    shape,
    input,
    ok: r.success,
    ...(r.success ? { output: r.data } : { pretty: z.prettifyError(r.error) }),
  });
};
for (const value of [...STRINGS, ...JUNK.filter((v) => v !== undefined)]) {
  record("CampaignID", value);
  record("CreateGame", { name: value });
  record("CreateGame", { name: "x", rulesetVersionId: value });
  record("AdminCreate", { name: "x", ownerUserId: value, extra: 1 });
  record("Rename", { name: value });
  record("Join", { token: value });
}
for (const junk of JUNK.filter((v) => v !== undefined)) {
  for (const shape of ["CreateGame", "AdminCreate", "Rename", "Join"]) record(shape, junk);
}
for (const shape of ["CreateGame", "AdminCreate", "Rename", "Join"]) record(shape, {});
record("AdminCreate", { name: "", rulesetVersionId: "x", ownerUserId: "" });

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    refusals: REFUSALS,
    messages: [
      { code: "unauthorized", body: refusalBody("unauthorized") },
      { code: "badRequest", params: { detail: "a <b>" }, body: refusalBody("badRequest", { detail: "a <b>" }) },
      { code: "inviteCharacterLimit", params: { limit: 50 }, body: refusalBody("inviteCharacterLimit", { limit: 50 }) },
      {
        code: "undoChanged",
        params: { target: "x", now: 1.5 },
        body: refusalBody("undoChanged", { target: "x", now: 1.5 }),
      },
      { code: "noField", params: {}, body: refusalBody("noField", {}) },
    ],
    permissions,
    gmPerm: Object.fromEntries(
      (["pc", "companion", "npc", "creature", "group", "vehicle", "hazard"] as const).map((k) => [k, gmPermOf(k)]),
    ),
    shapes,
  }),
);
console.log(`core vectors: ${permissions.length} seats, ${shapes.length} shapes`);
