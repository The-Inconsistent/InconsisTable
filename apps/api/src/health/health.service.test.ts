import { test } from "node:test";
import assert from "node:assert/strict";
import { ServiceUnavailableException } from "@nestjs/common";
import { assertDbUp } from "./health.service.ts";

test("a failing database ping is a 503 that says nothing about why", async () => {
  await assert.rejects(
    assertDbUp(() => Promise.reject(new Error("password authentication failed for user it"))),
    (e: ServiceUnavailableException) => e.getStatus() === 503 && !JSON.stringify(e.getResponse()).includes("password"),
  );
});

test("a working ping passes", async () => {
  await assertDbUp(() => Promise.resolve());
});
