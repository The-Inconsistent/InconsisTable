import assert from "node:assert/strict";
import { test } from "node:test";

import { ROOM_LIMITS, RoomDocument } from "./room-document.ts";

const ID = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const BASE = { format: "inconsistable-room", version: 1, room: { name: "Kitchen Table" } } as const;

test("a room document needs only its format, version and name; a scene's prep keeps its defaults", () => {
  assert.deepEqual(RoomDocument.parse(BASE), BASE);
  const doc = RoomDocument.parse({
    ...BASE,
    codex: [{ id: ID(1), kind: "scene", title: "Quay", prep: { reveals: [{ id: "v", entryId: ID(2) }] } }],
  });
  assert.deepEqual(doc.codex?.[0]?.prep, {
    roster: [],
    tests: [],
    pools: [],
    exits: [],
    reveals: [{ id: "v", entryId: ID(2) }],
  });
});

test("refused: another format, a key it does not know, a repeated id, a built actor with a type, a list past its cap", () => {
  const refused = (input: unknown) => assert.equal(RoomDocument.safeParse(input).success, false);
  refused({ ...BASE, format: "another-app" });
  refused({ ...BASE, owner: "me" });
  refused({ ...BASE, codex: [1, 2].map(() => ({ id: ID(1), kind: "lore", title: "x" })) });
  refused({ ...BASE, actors: [{ id: ID(1), kind: "pc", name: "x", build: "{}", entityType: "hero" }] });
  // The values a build does not write come beside it.
  assert.equal(
    RoomDocument.safeParse({ ...BASE, actors: [{ id: ID(1), kind: "pc", name: "x", build: "{}", fields: { xp: 5 } }] })
      .success,
    true,
  );
  refused({ ...BASE, clocks: Array.from({ length: ROOM_LIMITS.clocks + 1 }, (_, i) => ({ name: `c${i}` })) });
  refused({ ...BASE, clocks: [{ name: "c", segments: 4, filled: 5 }] });
});
