import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVICE_COOKIE, deviceSecret } from "@inconsistable/auth/api";

// deviceUser writes to Postgres, so this runs only with DATABASE_URL set (a migrated database, e.g. the smoke one).
const dbTest = process.env.DATABASE_URL ? test : test.skip; // needs a migrated database
const load = async () => {
  const [{ deviceUser, hash }, { db }, { appUser, device }, { eq, inArray }] = await Promise.all([
    import("./auth.service.ts"),
    import("../core/db.ts"),
    import("./auth.schema.ts"),
    import("drizzle-orm"),
  ]);
  const countFor = async (secrets: string[]) =>
    (
      await db
        .select()
        .from(device)
        .where(inArray(device.tokenHash, secrets.map(hash)))
    ).length;
  const cleanup = async (secrets: string[]) => {
    const rows = await db
      .select()
      .from(device)
      .where(inArray(device.tokenHash, secrets.map(hash)));
    for (const r of rows) await db.delete(appUser).where(eq(appUser.id, r.userId)); // the device row cascades
  };
  return { deviceUser, countFor, cleanup };
};
const cookie = (secret: string) => ({ cookie: `${DEVICE_COOKIE}=${secret}` });

dbTest("an unknown secret makes one user and one device; the next request is the same user", async () => {
  const { deviceUser, countFor, cleanup } = await load();
  const secret = deviceSecret();
  try {
    const first = await deviceUser(cookie(secret));
    assert.ok(first);
    assert.equal(first.name, "Player");
    assert.equal(first.creator, true);
    assert.deepEqual(await deviceUser(cookie(secret)), first);
    assert.equal(await countFor([secret]), 1);
  } finally {
    await cleanup([secret]);
  }
});

dbTest("two first requests at once make one user", async () => {
  const { deviceUser, countFor, cleanup } = await load();
  const secret = deviceSecret();
  try {
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => deviceUser(cookie(secret))));
    assert.ok(a && b && c);
    assert.equal(a.userId, b.userId);
    assert.equal(a.userId, c.userId);
    assert.equal(await countFor([secret]), 1);
  } finally {
    await cleanup([secret]);
  }
});

dbTest("another secret is another user", async () => {
  const { deviceUser, cleanup } = await load();
  const [s1, s2] = [deviceSecret(), deviceSecret()];
  try {
    const [a, b] = [await deviceUser(cookie(s1)), await deviceUser(cookie(s2))];
    assert.notEqual(a?.userId, b?.userId);
  } finally {
    await cleanup([s1, s2]);
  }
});

dbTest("a missing or malformed secret is no user and writes nothing", async () => {
  const { deviceUser } = await load();
  assert.equal(await deviceUser({}), null);
  assert.equal(await deviceUser({ cookie: "other=1" }), null);
  for (const bad of ["", "short", "x".repeat(31), "x".repeat(201), `${"x".repeat(31)}=`, "%", "a b".repeat(20)])
    assert.equal(await deviceUser(cookie(bad)), null, bad);
});
