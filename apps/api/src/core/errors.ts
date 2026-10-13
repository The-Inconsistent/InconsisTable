import type { Problem } from "@inconsistable/rules-engine";

// A client-facing refusal: the gateway returns its message to the sender.
export class ActionError extends Error {}

// An import the validator or the quota refused: the problems come back to the owner by path, as a 422.
export class ImportRefused extends Error {
  readonly problems: Problem[];
  readonly warnings: Problem[];
  constructor(problems: Problem[], warnings: Problem[] = []) {
    super(problems[0]?.message ?? "Import refused");
    this.problems = problems;
    this.warnings = warnings;
  }
}

// A declaration (not an arrow) so `if (!row) fail(...)` narrows `row` afterwards.
export function fail(msg: string): never {
  throw new ActionError(msg);
}
