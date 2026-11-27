import assert from "node:assert/strict";
import { test } from "node:test";

import { RoomDocument, type ActionInput, type RoomDocumentInput } from "@inconsistable/core-schema";

import { adventuresIn, planAdventures, UNSERVED_SOURCE, type Ids } from "./adventure-import";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = {
  road: id(1),
  quay: id(2),
  hill: id(3),
  other: id(4),
  far: id(5),
  town: id(10),
  dock: id(11),
  oyle: id(12),
  guild: id(13),
  notice: id(14),
  lore: id(15),
  mara: id(20),
  wren: id(21),
  pic: id(30),
};

// Invented: two adventures; the first's scenes mention, link, reveal and pick from entries, exit to each other and to
// the second adventure's scene, and plan a Test for two characters.
const DOC: RoomDocumentInput = {
  format: "inconsistable-room",
  version: 1,
  room: { name: "Harbour Watch" },
  actors: [
    { id: I.mara, kind: "pc", name: "Mara" },
    { id: I.wren, kind: "pc", name: "Wren" },
  ],
  codex: [
    { id: I.town, kind: "location", title: "Harbour town" },
    { id: I.dock, kind: "location", title: "Dock", parentId: I.town, imageId: I.pic, imageRevealed: true },
    { id: I.guild, kind: "faction", title: "The Salt Guild" },
    {
      id: I.oyle,
      kind: "npc",
      title: "Harbourmaster Oyle",
      fields: { patron: I.guild, mood: "wary" },
      visibility: "party",
    },
    { id: I.notice, kind: "handout", title: "Notice", layout: "proclamation", header: "By order" },
    {
      id: I.lore,
      kind: "lore",
      title: "Old tides",
      source: { entity: "legend", key: "tide-song", cite: "Sample p.9" },
    },
    { id: I.road, kind: "adventure", title: "The Salt Road" },
    { id: I.hill, kind: "scene", title: "The hill", parentId: I.road, position: 1 },
    {
      id: I.quay,
      kind: "scene",
      title: "On the quay",
      parentId: I.road,
      position: 0,
      status: "active",
      body: "Meet @[Oyle](" + I.oyle + ") at @[the dock](" + I.dock + "), not @[the tides](" + I.lore + ").",
      links: [I.oyle],
      prep: {
        exits: [
          { id: "e1", label: "Up", sceneId: I.hill },
          { id: "e2", label: "Away", sceneId: I.far },
        ],
        reveals: [{ id: "v1", entryId: I.notice }],
        tests: [{ id: "t1", testId: "check", takers: "listed", actorIds: [I.mara, I.wren] }],
      },
    },
    { id: I.other, kind: "adventure", title: "Elsewhere" },
    { id: I.far, kind: "scene", title: "Far away", parentId: I.other },
  ],
  images: [{ id: I.pic, mime: "image/jpeg", base64: "/9j/4AAQ" }],
};

const ROOM = {
  // The room already has the man, by another spelling of the same name, and Mara.
  entries: [{ id: "room-oyle", kind: "npc" as const, title: "  harbourmaster OYLE " }],
  actors: [{ id: "room-mara", name: "Mara" }],
};

const doc = RoomDocument.parse(DOC);

test("the document's adventures, with their scenes counted", () => {
  assert.deepEqual(adventuresIn(doc), [
    { id: I.road, title: "The Salt Road", scenes: 2 },
    { id: I.other, title: "Elsewhere", scenes: 1 },
  ]);
});

test("a picked adventure brings its scenes and what they need; a name the room has is linked", () => {
  const plan = planAdventures({ doc, picked: [I.road], room: ROOM });
  // Parents first; scenes by position; the dock's town comes with it; the guild comes through Oyle's field only if
  // Oyle is made, and he is matched, so it stays; the tides are mentioned by a scene and come.
  assert.deepEqual(
    plan.create.map((e) => e.title),
    ["Harbour town", "Notice", "Old tides", "The Salt Road", "On the quay", "The hill", "Dock"],
  );
  assert.deepEqual(plan.link, [{ id: I.oyle, kind: "npc", title: "Harbourmaster Oyle", to: "room-oyle" }]);
  assert.equal(plan.pictures, 1);
  // The exit to the other adventure's scene and Wren, whom the room does not have.
  assert.equal(plan.dropped, 2);
});

test("the steps, run, are the table's ordinary actions with the room's ids", () => {
  const plan = planAdventures({ doc, picked: [I.road], room: ROOM });
  const ids: Ids = {};
  const sent: ActionInput[] = [];
  let n = 0;
  for (const step of plan.steps) {
    if (step.kind === "picture") {
      ids[step.imageId] = "room-pic";
      continue;
    }
    const action = step.action(ids);
    sent.push(action);
    if (step.makes) ids[step.makes] = `new-${++n}`;
  }
  const made = (title: string) => ids[plan.create.find((e) => e.title === title)!.id]!;
  const saves = sent.filter((a) => a.type === "codex.save");
  // Every entry is made by kind and title alone, sealed: no reveal is ever sent.
  assert.ok(sent.every((a) => a.type !== "codex.reveal"));
  assert.deepEqual(
    sent.filter((a) => a.type === "codex.move"),
    [
      { type: "codex.move", id: made("On the quay"), parentId: made("The Salt Road"), position: 10_000 },
      { type: "codex.move", id: made("The hill"), parentId: made("The Salt Road"), position: 10_000 },
      { type: "codex.move", id: made("Dock"), parentId: made("Harbour town"), position: 10_000 },
    ],
  );
  const quay = saves.find((a) => a.type === "codex.save" && a.id === made("On the quay"));
  assert.ok(quay && quay.type === "codex.save");
  assert.equal(
    quay.body,
    `Meet @[Oyle](room-oyle) at @[the dock](${made("Dock")}), not @[the tides](${made("Old tides")}).`,
  );
  assert.equal(quay.status, undefined, "a scene arrives planned");
  assert.deepEqual(
    quay.prep?.exits?.map((l) => l.sceneId),
    [made("The hill")],
  );
  assert.deepEqual(
    quay.prep?.reveals?.map((l) => l.entryId),
    [made("Notice")],
  );
  assert.deepEqual(quay.prep?.tests?.[0]?.actorIds, ["room-mara"]);
  assert.ok(sent.some((a) => a.type === "codex.link" && a.id === made("On the quay") && a.targetId === "room-oyle"));
  const dock = saves.find((a) => a.type === "codex.save" && a.id === made("Dock"));
  assert.ok(dock && dock.type === "codex.save" && dock.imageId === "room-pic");
  const notice = saves.find((a) => a.type === "codex.save" && a.id === made("Notice"));
  assert.ok(notice && notice.type === "codex.save" && notice.layout === "proclamation" && notice.header === "By order");
  // Where an entry came from is kept (house decision #97): codex.save takes it, checked against the room's packs.
  const tides = saves.find((a) => a.type === "codex.save" && a.id === made("Old tides"));
  assert.deepEqual(tides && tides.type === "codex.save" && tides.source, {
    entity: "legend",
    key: "tide-song",
    cite: "Sample p.9",
  });
});

test("an entry from a pack entry has a step without it, for a room not served that entry (#232)", () => {
  const plan = planAdventures({ doc, picked: [I.road], room: ROOM });
  const ids: Ids = {};
  const fallbacks: ActionInput[] = [];
  for (const step of plan.steps) {
    if (step.kind !== "action") continue;
    if (step.withoutSource) fallbacks.push(step.withoutSource(ids));
    if (step.makes) ids[step.makes] = `new-${step.makes}`;
  }
  assert.equal(fallbacks.length, 1, "only the entry with a source has one");
  const tides = fallbacks[0];
  assert.ok(tides && tides.type === "codex.save" && tides.id === `new-${I.lore}`);
  assert.equal("source" in tides, false);
  assert.ok(UNSERVED_SOURCE.has("fromPackNoEntry") && UNSERVED_SOURCE.has("fromPackNotFor"));
});

test("a made entry's link field names the made entry; one not brought is left out", () => {
  const plan = planAdventures({ doc, picked: [I.road], room: { entries: [], actors: [] } });
  assert.ok(
    plan.create.some((e) => e.title === "The Salt Guild"),
    "Oyle is made, so his patron comes",
  );
  const ids: Ids = {};
  let oyle: ActionInput | undefined;
  for (const step of plan.steps) {
    if (step.kind !== "action") continue;
    const a = step.action(ids);
    if (step.makes) ids[step.makes] = `new-${step.makes}`;
    if (a.type === "codex.save" && a.id === `new-${I.oyle}`) oyle = a;
  }
  assert.deepEqual(oyle && oyle.type === "codex.save" && oyle.fields, { patron: `new-${I.guild}`, mood: "wary" });
});

test("nothing picked brings nothing", () => {
  const plan = planAdventures({ doc, picked: [], room: ROOM });
  assert.deepEqual([plan.create, plan.link, plan.steps], [[], [], []]);
});
