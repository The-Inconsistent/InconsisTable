import { test } from "node:test";
import assert from "node:assert/strict";

import type { Whisper } from "@inconsistable/core-schema";

import { replyKeys, unreadOf } from "./whispers";

const reader = (actorId: string, readAt: string | null, reply: string | null = null) => ({
  actorId,
  reply,
  repliedAt: reply === null ? null : `t-${reply}`,
  readAt,
});
// Newest first, as the state carries them.
const whispers: Whisper[] = [
  { id: "w2", text: "new", createdAt: "2", readers: [reader("a", null), reader("b", "r", "yes")] },
  { id: "w1", text: "old", createdAt: "1", readers: [reader("a", null)] },
];

test("unread whispers come oldest first, one per unread reader, minus those closed here", () => {
  assert.deepEqual(
    unreadOf({ whispers, closed: new Set() }).map((u) => u.key),
    ["w1:a", "w2:a"],
  );
  assert.deepEqual(
    unreadOf({ whispers, closed: new Set(["w1:a"]) }).map((u) => u.key),
    ["w2:a"],
  );
});

test("a reply's key changes with its time, so a new reply is unseen again", () => {
  assert.deepEqual(replyKeys(whispers), ["w2:b:t-yes"]);
});
