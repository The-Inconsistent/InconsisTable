import {
  Pack,
  PRIVATE_TEXT_WARN_CHARS,
  compileRuleset,
  formatPath,
  validatePack,
  validateRuleset,
  type Problem,
  type Ruleset,
} from "@inconsistable/rules-engine";

// The guided form is a view over the manifest JSON (docs/p2-plan.md group E): its state IS the document, each section
// edits a slice of it, and these helpers are the whole "model". Nothing here knows a game; the TS validators the api
// shares stay the single source of truth for what is right.

export type Doc = Record<string, unknown>;
export type PathPart = string | number;
export type Path = readonly PathPart[];
export type FormKind = "ruleset" | "pack";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The value at a path, or undefined where the document does not reach. */
export function getAt(doc: unknown, path: Path): unknown {
  let at = doc;
  for (const part of path) {
    if (!isObject(at)) return undefined;
    at = (at as Record<PathPart, unknown>)[part];
  }
  return at;
}

/** A copy of the document with the value set at the path; `undefined` removes the key. Parents are created. */
export function setAt({ doc, path, value }: { doc: unknown; path: Path; value: unknown }): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const copy: unknown = Array.isArray(doc) ? [...doc] : isObject(doc) ? { ...doc } : typeof head === "number" ? [] : {};
  const holder = copy as Record<PathPart, unknown>;
  const next = rest.length === 0 ? value : setAt({ doc: holder[head], path: rest, value });
  if (next === undefined && !Array.isArray(copy)) delete holder[head];
  else holder[head] = next;
  return copy;
}

/** A copy without the array element or object key at the path. */
export function removeAt({ doc, path }: { doc: unknown; path: Path }): unknown {
  const parent = path.slice(0, -1);
  const last = path.at(-1);
  const holder = getAt(doc, parent);
  if (last === undefined) return doc;
  if (Array.isArray(holder)) {
    return setAt({ doc, path: parent, value: holder.filter((_, i) => i !== last) });
  }
  return setAt({ doc, path, value: undefined });
}

/** An object with one key renamed, keeping the order of the others (a renamed field stays where it was). */
export function renameKey({ obj, from, to }: { obj: Record<string, unknown>; from: string; to: string }) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]));
}

/** Stored documents and exports may carry `null` for "absent"; the manifest schemas know only a missing key. */
export function stripNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (!isObject(v)) return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([, x]) => x !== null)
      .map(([k, x]) => [k, stripNulls(x)]),
  );
}

export const serialize = (doc: unknown) => JSON.stringify(doc, null, 2);

// ---- Sections ----

export const RULESET_SECTIONS = [
  "about",
  "game",
  "fields",
  "resources",
  "conditions",
  "tests",
  "turn",
  "creation",
  "board",
  "more",
  "json",
] as const;
export type RulesetSection = (typeof RULESET_SECTIONS)[number];

export const PACK_SECTIONS = ["about", "entries", "json"] as const;
export type PackSection = (typeof PACK_SECTIONS)[number];

const RULESET_ROOTS: Record<string, RulesetSection> = {
  id: "about",
  version: "about",
  core: "about",
  sources: "about",
  game: "game",
  entities: "fields",
  resources: "resources",
  conditions: "conditions",
  tests: "tests",
  initiative: "turn",
  creation: "creation",
  phases: "board",
  scoring: "board",
  extends: "more",
  terms: "more",
  options: "more",
  health: "more",
  decisions: "more",
  layout: "more",
};

const rootOf = (path: string) => /^[^.[]+/.exec(path)?.[0] ?? "";

/** The section a validator path belongs to. "(root)" and anything the form does not know land in About / JSON. */
export function sectionOfRuleset(path: string): RulesetSection {
  if (path === "(root)") return "about";
  return RULESET_ROOTS[rootOf(path)] ?? "json";
}

const PACK_ROOTS: Record<string, PackSection> = {
  id: "about",
  version: "about",
  ruleset: "about",
  license: "about",
  attribution: "about",
  sources: "about",
  entries: "entries",
};

export function sectionOfPack(path: string): PackSection {
  if (path === "(root)") return "about";
  return PACK_ROOTS[rootOf(path)] ?? "json";
}

/** The problems at or under a path prefix such as `entries[3]`. */
export function problemsUnder({ problems, prefix }: { problems: readonly Problem[]; prefix: string }): Problem[] {
  return problems.filter(
    (p) => p.path === prefix || p.path.startsWith(`${prefix}.`) || p.path.startsWith(`${prefix}[`),
  );
}

// ---- Validation ----

export interface Checked {
  problems: Problem[];
  warnings: Problem[];
  /** The validated ruleset, when the document is one that passes; a pack form checks entries against it. */
  ruleset?: Ruleset;
}

/**
 * The TS validators over the current document. A ruleset runs the compiler (which validates first); a pack runs
 * `validatePack` against the target ruleset when the form has it, else the schema alone: the api checks the rest.
 */
export function check({ kind, doc, target }: { kind: FormKind; doc: unknown; target?: Ruleset | null }): Checked {
  if (kind === "ruleset") {
    const r = compileRuleset(doc);
    if (!r.ok) return { problems: r.problems, warnings: [] };
    const v = validateRuleset(doc);
    return { problems: [], warnings: [], ruleset: v.ok ? v.ruleset : undefined };
  }
  if (target) {
    const r = validatePack({ input: doc, ruleset: target });
    return { problems: r.ok ? [] : r.problems, warnings: r.warnings };
  }
  const parsed = Pack.safeParse(doc);
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message }));
  return { problems, warnings: [] };
}

/** Every source homebrew: nothing printed backs the rules, so a cite is optional (the validator's own rule). */
export function isHomebrew(doc: unknown): boolean {
  const sources = getAt(doc, ["sources"]);
  return Array.isArray(sources) && sources.length > 0 && sources.every((s) => getAt(s, ["license"]) === "homebrew");
}

/** A `private` ruleset (any source) or pack: its descriptions are checked for pasted book text. */
export function isPrivate({ kind, doc }: { kind: FormKind; doc: unknown }): boolean {
  if (kind === "pack") return getAt(doc, ["license"]) === "private";
  const sources = getAt(doc, ["sources"]);
  return Array.isArray(sources) && sources.some((s) => getAt(s, ["license"]) === "private");
}

/** Principle 2: a long description in a private document probably came from the book. A hint, never a block. */
export function longTextWarning({ text, priv }: { text: string; priv: boolean }): boolean {
  return priv && text.length > PRIVATE_TEXT_WARN_CHARS;
}

/** Whether a pack's entries need a cite: not for an `original` pack, nor against a homebrew ruleset. */
export function packNeedsCite({ doc, target }: { doc: unknown; target?: Ruleset | null }): boolean {
  if (getAt(doc, ["license"]) === "original") return false;
  return !(target?.sources.every((s) => s.license === "homebrew") ?? false);
}

// ---- New documents ----

/** A homebrew ruleset with only what the schema insists on. */
export function newRuleset(): Doc {
  return {
    id: "",
    version: "0.1.0",
    core: "^0.1.0",
    sources: [{ id: "book", title: "", license: "homebrew" }],
    entities: [{ id: "character", label: "Character", base: "actor", fields: {} }],
  };
}

export function newPack({ rulesetId = "" }: { rulesetId?: string } = {}): Doc {
  return { id: "", version: "0.1.0", ruleset: { id: rulesetId, range: "^0.1.0" }, license: "private", entries: [] };
}
