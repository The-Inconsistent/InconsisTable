// What the TypeScript game module validator answers (packages/rules-engine/src/module.ts), for internal/engine/module.go
// to match: valid and refused modules with their problems and hashes. Every module here is invented. generate.ts
// writes these under `modules`.
import {
  SAMPLE_MODULE,
  SAMPLE_NAMING_MODULE,
  SAMPLE_SKIRMISH_MODULE,
} from "../../../packages/rules-engine/src/fixtures/sample-module.ts";
import {
  MAX_MODULE_BYTES,
  MAX_MODULE_PACKS,
  moduleHash,
  validateModule,
} from "../../../packages/rules-engine/src/module.ts";

const part = (slug: string, extra: Record<string, unknown> = {}) => ({ slug, version: "1.0.0", ...extra });
const named = (extra: Record<string, unknown> = {}) => ({
  id: "m",
  version: "1.0.0",
  core: "^1.0.0",
  name: "M",
  ruleset: part("r"),
  packs: [part("p")],
  ...extra,
});
const HASH = "a".repeat(64);
const JUNK: unknown[] = [null, 1, true, "x", [], {}];

function cases(): unknown[] {
  const inputs: unknown[] = [
    SAMPLE_MODULE,
    SAMPLE_SKIRMISH_MODULE,
    SAMPLE_NAMING_MODULE,
    named(),
    named({ packs: [] }),
    named({ world: part("w", { hash: HASH }), ruleset: part("r", { hash: HASH }) }),
    named({ documents: {} }),
    named({ documents: { ruleset: { id: "r" }, packs: [{}, null], world: 1 } }),
    named({ documents: { ruleset: null } }),
    named({ name: "n".repeat(80) }),
    // Refused, one kind of problem each.
    named({ packs: [part("a"), part("b"), part("a"), part("b")] }),
    named({ packs: Array.from({ length: MAX_MODULE_PACKS }, (_, i) => part(`p${i}`)) }),
    named({ packs: Array.from({ length: MAX_MODULE_PACKS + 1 }, (_, i) => part(`p${i}`)) }),
    named({ documents: { packs: Array.from({ length: MAX_MODULE_PACKS + 1 }, () => ({})) } }),
    named({ ruleset: part("r", { hash: "A".repeat(64) }) }),
    named({ ruleset: part("r", { hash: "a".repeat(63) }) }),
    named({ ruleset: part("r", { extra: 1 }) }),
    named({ ruleset: { slug: "Not Kebab", version: "1.0" } }),
    named({ packs: [{ version: "1.0.0" }] }),
    named({ world: {} }),
    named({ extra: true }),
    named({ documents: { rulesets: [] } }),
    named({ name: "" }),
    named({ name: "n".repeat(81) }),
    named({ core: "one" }),
    named({ id: "a".repeat(65) }),
    { id: "m" },
    {},
    null,
    [],
    "module",
    // The size cap, as serialised: just under and just over.
    named({ documents: { ruleset: { pad: "x".repeat(MAX_MODULE_BYTES - 300) } } }),
    named({ documents: { ruleset: { pad: "x".repeat(MAX_MODULE_BYTES) } } }),
  ];
  for (const key of ["id", "version", "core", "name", "ruleset", "packs", "world", "documents"])
    for (const junk of JUNK) inputs.push(named({ [key]: junk }));
  for (const key of ["slug", "version", "hash"]) for (const junk of JUNK) inputs.push(named({ ruleset: part("r", { [key]: junk }) }));
  for (const junk of JUNK) inputs.push(named({ documents: { packs: junk } }));

  return inputs.map((input) => {
    const r = validateModule(input);
    return r.ok
      ? { input, ok: true, module: r.module, hash: moduleHash(r.module) }
      : { input, ok: false, problems: r.problems };
  });
}

export function moduleVectors() {
  return { maxBytes: MAX_MODULE_BYTES, maxPacks: MAX_MODULE_PACKS, cases: cases() };
}
