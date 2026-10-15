import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCampaigns, sortByLastPlayed, type AdminCampaign } from "./admin.ts";

const room = (name: string, ownerName: string | null, lastPlayedAt: string | null): AdminCampaign => ({
  id: "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
  name,
  ownerUserId: ownerName && "u",
  ownerName,
  ruleset: null,
  rulesetVersion: null,
  lastPlayedAt,
  archived: false,
});
const rooms = [
  room("Ashfall", "Dana", null),
  room("Barrow", "Eli", "2026-05-01T10:00:00Z"),
  room("Cinder", null, "2026-06-01T10:00:00Z"),
];

test("filter matches name or owner, ignoring case and padding", () => {
  assert.deepEqual(
    filterCampaigns({ campaigns: rooms, query: " ASH " }).map((c) => c.name),
    ["Ashfall"],
  );
  assert.deepEqual(
    filterCampaigns({ campaigns: rooms, query: "eli" }).map((c) => c.name),
    ["Barrow"],
  );
  assert.equal(filterCampaigns({ campaigns: rooms, query: "" }).length, 3);
});

test("sort puts the latest game first and never-played rooms last", () => {
  assert.deepEqual(
    sortByLastPlayed(rooms).map((c) => c.name),
    ["Cinder", "Barrow", "Ashfall"],
  );
});
