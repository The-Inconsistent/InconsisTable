import { test } from "node:test";
import assert from "node:assert/strict";
import { REFUSALS, refusalBody, refusalMessage, refused } from "./refusals.ts";

test("params fill the slots; a slot with no param stays visible", () => {
  assert.equal(refusalMessage("onlySpend", { what: "Focus" }), "You can only spend Focus");
  assert.equal(refusalMessage("onlySpend"), "You can only spend {what}");
  assert.equal(
    refusalMessage("inviteCharacterLimit", { limit: 3 }),
    "This invite has made 3 characters, its limit. Ask your GM for a new one",
  );
});

test("a refusal travels as code, message and params; the ack repeats the message as error", () => {
  assert.deepEqual(refusalBody("notYourCharacter"), { code: "notYourCharacter", message: "Not your character" });
  assert.deepEqual(refused("onlySpend", { what: "HP" }), {
    ok: false,
    error: "You can only spend HP",
    code: "onlySpend",
    message: "You can only spend HP",
    params: { what: "HP" },
  });
});

test("every message is non-empty", () => {
  for (const [code, text] of Object.entries(REFUSALS)) assert.ok(text.length > 0, code);
});
