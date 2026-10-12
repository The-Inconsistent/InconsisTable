import { test } from "node:test";
import assert from "node:assert/strict";
import { qrImage } from "./qr.ts";

test("a join link becomes a PNG data URL", async () => {
  const url = await qrImage("https://table.example/join/abc");
  assert.match(url, /^data:image\/png;base64,/);
  assert.notEqual(url, await qrImage("https://table.example/join/abd"));
});
