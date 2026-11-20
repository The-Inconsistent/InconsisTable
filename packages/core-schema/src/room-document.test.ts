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
    picks: [],
  });
});

test("an entry's tags and rows travel as its other field values do (house decision #89)", () => {
  const rows = [{ id: "d1", from: { entity: "creature", key: "wisp" }, values: { threat: 2 } }];
  const doc = RoomDocument.parse({
    ...BASE,
    codex: [
      { id: ID(1), kind: "location", title: "Ford", fields: { dangers: rows, marks: ["a", "b"] } },
      {
        id: ID(2),
        kind: "scene",
        title: "Crossing",
        prep: { picks: [{ id: "k", entryId: ID(1), field: "dangers", rows: [{ rowId: "d1" }] }] },
      },
    ],
  });
  assert.deepEqual(doc.codex?.[0]?.fields, { dangers: rows, marks: ["a", "b"] });
  assert.deepEqual(doc.codex?.[1]?.prep?.picks, [
    { id: "k", entryId: ID(1), field: "dangers", rows: [{ rowId: "d1", on: false }] },
  ]);
  const many = Array.from({ length: 31 }, (_, i) => ({ id: `r${i}` }));
  assert.equal(
    RoomDocument.safeParse({ ...BASE, codex: [{ id: ID(1), kind: "location", title: "x", fields: { d: many } }] })
      .success,
    false,
  );
});

test("a roster line's marker and spawn options travel in the document (house decision #92)", () => {
  const line = { id: "r", pack: "p", key: "k", count: 2, marker: "amber", options: ["hardened", "quick"] };
  const doc = RoomDocument.parse({
    ...BASE,
    codex: [{ id: ID(1), kind: "scene", title: "Gate", prep: { roster: [line] } }],
  });
  assert.deepEqual(doc.codex?.[0]?.prep?.roster[0], { ...line, visibility: "hidden", temporary: true });
  const bad = (over: object) =>
    RoomDocument.safeParse({
      ...BASE,
      codex: [{ id: ID(1), kind: "scene", title: "G", prep: { roster: [{ ...line, ...over }] } }],
    }).success;
  assert.equal(bad({ marker: "black" }), false);
  assert.equal(bad({ options: ["a", "a"] }), false);
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
