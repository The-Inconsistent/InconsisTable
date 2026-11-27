import assert from "node:assert/strict";
import { test } from "node:test";

import { fromLocalInput, NEXT_SESSION_FORMAT, toLocalInput } from "./next-session";

test("a stored date goes to the input in this zone and back to the same instant", () => {
  const iso = "2026-12-05T17:30:00.000Z";
  const local = toLocalInput(iso);
  assert.match(local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(fromLocalInput(local), iso);
});

test("the input reads as local time, whatever this zone is", () => {
  const d = new Date(2026, 11, 5, 18, 0); // 5 Dec 2026, 18:00 here
  assert.equal(fromLocalInput("2026-12-05T18:00"), d.toISOString());
  assert.equal(toLocalInput(d.toISOString()), "2026-12-05T18:00");
});

test("nothing set, or nothing readable, is none", () => {
  assert.equal(toLocalInput(null), "");
  assert.equal(toLocalInput("not a date"), "");
  assert.equal(fromLocalInput(""), null);
  assert.equal(fromLocalInput("soon"), null);
});

test("the shown line carries the day and the time, in the zone it is shown in", () => {
  const at = new Date("2026-12-05T17:30:00Z");
  const line = (timeZone: string) => new Intl.DateTimeFormat("en-GB", { ...NEXT_SESSION_FORMAT, timeZone }).format(at);
  assert.match(line("UTC"), /Sat.*17:30/);
  assert.match(line("Asia/Ho_Chi_Minh"), /Sun.*00:30/);
});
