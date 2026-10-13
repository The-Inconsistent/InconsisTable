import { test } from "node:test";
import assert from "node:assert/strict";
import type { BuilderDraftBody, Ctx, LiveState } from "@inconsistable/core-schema";
import { forUser } from "./actor.draft.ts";

const state = { myDraft: null } as unknown as LiveState;
const seat = (userId: string | null): Ctx => ({
  campaignId: "c",
  userId,
  campaignOwnerId: "gm",
  seat: { kind: "member", role: "player", scopes: [], characterIds: [] },
});
const mine: BuilderDraftBody = { actorId: "7b0a3f0e-0000-4000-8000-000000000001", answers: { scores: { str: 15 } } };

test("a draft reaches its owner only", () => {
  const drafts = new Map([["ana", mine]]);
  assert.deepEqual(forUser({ state, drafts, ctx: seat("ana") }).myDraft, mine);
  assert.equal(forUser({ state, drafts, ctx: seat("ben") }).myDraft, null);
  assert.equal(forUser({ state, drafts, ctx: seat(null) }).myDraft, null); // a guest has no account to keep one under
});
