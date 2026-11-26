import assert from "node:assert/strict";
import { test } from "node:test";

import { fitPage, pdfPage } from "./book-page.ts";

const sources = [
  { id: "sample", title: "Sample", license: "private" as const },
  { id: "companion", title: "Companion", license: "private" as const, pageOffset: 2 },
  { id: "front", title: "Front", license: "private" as const, pageOffset: -1 },
];

test("a printed page becomes its PDF page through the source's pageOffset", () => {
  assert.equal(pdfPage({ page: { source: "sample", page: 7 }, sources }), 7);
  assert.equal(pdfPage({ page: { source: "companion", page: 7 }, sources }), 9);
  assert.equal(pdfPage({ page: { source: "front", page: 7 }, sources }), 6);
  // A source the ruleset no longer lists is read without an offset.
  assert.equal(pdfPage({ page: { source: "gone", page: 7 }, sources }), 7);
});

test("the quality ladder stops at the first encoding under the limit, or gives up", async () => {
  const sizes: Record<number, number> = { 0.8: 900, 0.6: 400, 0.4: 100 };
  const tried: number[] = [];
  const encode = async (q: number) => {
    tried.push(q);
    return new Blob([new Uint8Array(sizes[q] ?? 0)]);
  };
  const fit = await fitPage({ encode, qualities: [0.8, 0.6, 0.4], max: 500 });
  assert.equal(fit?.size, 400);
  assert.deepEqual(tried, [0.8, 0.6]);
  assert.equal(await fitPage({ encode, qualities: [0.8], max: 500 }), null);
  // A canvas that cannot encode (toBlob gives null) is tried at the next quality.
  assert.equal(
    (await fitPage({ encode: async (q) => (q === 0.8 ? null : new Blob(["x"])), qualities: [0.8, 0.6], max: 5 }))?.size,
    1,
  );
});
