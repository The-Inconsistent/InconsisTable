import { test } from "node:test";
import assert from "node:assert/strict";
import { REFUSALS } from "@inconsistable/core-schema";
import { RefusalCode } from "@inconsistable/rules-engine";
import { ActionError, fail } from "./errors.ts";

test("every engine refusal code has a catalogue entry", () => {
  for (const code of RefusalCode.options) assert.ok(code in REFUSALS, code);
});

test("fail throws an ActionError whose message is the English text", () => {
  assert.throws(
    () => fail("onlySpend", { what: "Focus" }),
    (e) => e instanceof ActionError && e.code === "onlySpend" && e.message === "You can only spend Focus",
  );
});
