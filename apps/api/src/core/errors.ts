import { refusalBody, refusalMessage, type RefusalKey, type RefusalParams } from "@inconsistable/core-schema";
import type { Problem } from "@inconsistable/rules-engine";

// A client-facing refusal: the gateway returns its code, English message and params to the sender, REST as the body.
export class ActionError extends Error {
  constructor(
    readonly code: RefusalKey,
    readonly params?: RefusalParams,
  ) {
    super(refusalMessage(code, params));
  }

  body() {
    return refusalBody(this.code, this.params);
  }
}

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
export function fail(code: RefusalKey, params?: RefusalParams): never {
  throw new ActionError(code, params);
}
