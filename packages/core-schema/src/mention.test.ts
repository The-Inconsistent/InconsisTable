import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { hideMentions, mentionOf, splitMentions } from "./mention.ts";

describe("@mention", () => {
  test("a title cannot break out of its brackets", () => {
    assert.equal(mentionOf({ id: "e1", title: "A [odd]\ntitle" }), "@[A  odd  title](e1)");
  });

  test("a body is cut into text and mentions", () => {
    assert.deepEqual(splitMentions("see @[Ada](e1), not @ alone"), [
      { text: "see " },
      { title: "Ada", id: "e1" },
      { text: ", not @ alone" },
    ]);
  });

  test("only the mentions the seat cannot read become the hidden form", () => {
    assert.equal(hideMentions({ body: "@[A](a) and @[B](b)", canSee: (id) => id === "a" }), "@[A](a) and @[…](hidden)");
  });
});
