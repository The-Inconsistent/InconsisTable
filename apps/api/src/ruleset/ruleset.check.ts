import { canonicalJson, compileRuleset, sha256Hex, type Problem, type Ruleset } from "@inconsistable/rules-engine";

export type RulesetCheck = { ok: true; ruleset: Ruleset; hash: string } | { ok: false; problems: Problem[] };

/**
 * A manifest as the owner pasted it: validated and every expression compiled, returned normalized (defaults applied)
 * with the hash of that document. The hash is the compiled cache key and tells a repeat import from a changed one.
 */
export function checkRuleset(input: unknown): RulesetCheck {
  const result = compileRuleset(input);
  if (!result.ok) return { ok: false, problems: result.problems };
  const normalized = result.compiled.ruleset;
  return { ok: true, ruleset: normalized, hash: sha256Hex(canonicalJson(normalized)) };
}
