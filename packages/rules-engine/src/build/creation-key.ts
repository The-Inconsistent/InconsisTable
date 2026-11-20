import type { CharacterBuild } from "./schemas.ts";

/**
 * The creation part of a build, as a stable string (Auspex `creationKey`, house decision #64): what a player may no
 * longer change once the character is made, which is everything but the advancement (its purchase history included),
 * the choices its grants ask for (paths under `advance/`) and the GM's part. Keys are sorted at every depth, so two
 * builds with the same choices compare equal however their objects were put together. Auspex sorts with
 * `localeCompare`; this compares UTF-16 code units, which the Go twin reproduces exactly.
 */
export function creationKey(b: CharacterBuild): string {
  const part = {
    ...b,
    advancement: undefined,
    gm: undefined,
    choices: Object.fromEntries(Object.entries(b.choices).filter(([k]) => !k.startsWith("advance/"))),
  };
  return JSON.stringify(part, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v,
  );
}
