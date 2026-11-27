import {
  compileRuleset,
  validateRuleset,
  type Problem,
  type Ruleset,
} from "../../../../packages/rules-engine/src/index.ts";

// The manifest a seat is served must compile (house decision #101). Cutting a definition a seat may not read leaves the
// parts that name it dangling, so the compiler's own problems say where: each is answered with one cut, and the
// manifest compiled again, until it compiles. A cut only removes or narrows, so nothing is served that was not before.
// The twin of internal/view/compiles.go: the same problems in the same order give the same cuts.

type Key = string | number;
type Node = Record<string, unknown> | unknown[];

/** What answers a problem inside a part: narrow it to the actor types it compiles for (`narrow`), or cut it whole. */
type Answer = "narrow" | "narrowOrCut" | "cut";

/**
 * The parts a problem inside is answered for as a whole, `*` any key or index. `narrow`: a definition scoped to actor
 * types whose expression reads what one type hides keeps the types it compiles for; another problem inside is cut
 * where it names. `narrowOrCut`: a spend not narrowed is cut whole, never left without the cost the seat cannot see
 * (house decision #84); a strike, whose figures and outcomes go together. `cut`: an offer (the GM side's alone, #80), an
 * effect, a reminder, a side's cost, a generator.
 */
const PARTS: readonly { at: readonly string[]; answer: Answer }[] = [
  { at: ["resources", "*"], answer: "narrow" },
  { at: ["tests", "*"], answer: "narrow" },
  { at: ["tests", "*", "offers", "*"], answer: "cut" },
  { at: ["health", "states", "*"], answer: "narrow" },
  { at: ["health", "harm", "profiles", "*"], answer: "narrow" },
  { at: ["notices", "*"], answer: "narrow" },
  { at: ["spends", "*"], answer: "narrowOrCut" },
  { at: ["spawn", "options", "*"], answer: "narrow" },
  { at: ["spawn", "options", "*", "effects", "*"], answer: "cut" },
  { at: ["spawn", "adjust", "*"], answer: "narrow" },
  { at: ["tables", "*"], answer: "narrow" },
  { at: ["conditions", "*", "effects", "*"], answer: "cut" },
  { at: ["reminders", "*"], answer: "cut" },
  { at: ["initiative", "outOfTurn", "cost", "*"], answer: "cut" },
  { at: ["initiative", "barred", "liftCost", "*"], answer: "cut" },
  // A strike the seat cannot work out (a figure, an addition, an outcome, a value) is not guided on it; a means, a
  // further number or a note it cannot read goes alone (house decision #99: nothing reads them).
  { at: ["strikes", "*"], answer: "narrowOrCut" },
  { at: ["strikes", "*", "means", "*"], answer: "cut" },
  { at: ["strikes", "*", "shows", "*"], answer: "cut" },
  { at: ["strikes", "*", "notes", "*"], answer: "cut" },
  // A step's `when` or a pick's `filter` cut alone would ask what the server's run check refuses (house decision #98).
  { at: ["generators", "*"], answer: "cut" },
  // A panel narrows like a spend's part of the sheet; a line or a figure it cannot read goes alone (house decision #114).
  { at: ["panels", "*"], answer: "narrow" },
  { at: ["panels", "*", "lines", "*"], answer: "cut" },
  { at: ["panels", "*", "figures", "*"], answer: "cut" },
  { at: ["panels", "*", "options"], answer: "cut" },
];

/** A guard: cut alone it would make its part hold always, so the part goes with it. */
// A panel's `opensOn` guards it as `when` does (house decision #114).
const GUARDS = new Set(["if", "when", "opensOn"]);
const MAX_CUTS = 200;

/** The manifest as served, cut until it compiles; returned as it came when it already does. */
export function compilable(manifest: Ruleset): Ruleset {
  let m: Ruleset = manifest;
  for (let i = 0; i < MAX_CUTS; i++) {
    const problems = problemsOf(m);
    const first = problems[0];
    if (first === undefined) return m;
    const next = answer(m, first);
    // ponytail: a problem no cut answers leaves the manifest as it is (the phone works without `compiled`, as before);
    // add its part to PARTS when one shows up.
    if (next === null) return m;
    m = next;
  }
  return m;
}

export function problemsOf(m: unknown): Problem[] {
  const r = compileRuleset(m);
  if (r.ok) return [];
  return [...r.problems].sort((a, b) => compare(a.path, b.path) || compare(a.message, b.message));
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `a.b[2].c` as segments; a dotted key (`attr.str`) is joined again where the document has it. */
function segmentsOf(path: string): Key[] {
  const out: Key[] = [];
  for (const part of path.split(".")) {
    const name = part.replace(/\[\d+\]/g, "");
    if (name !== "") out.push(name);
    for (const m of part.matchAll(/\[(\d+)\]/g)) out.push(Number(m[1]));
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The keys of the document a path reaches, as far as it reaches; `whole` when it reaches the end. */
function locate(root: unknown, path: string): { keys: Key[]; whole: boolean } {
  const segs = segmentsOf(path);
  const keys: Key[] = [];
  let node = root;
  let i = 0;
  while (i < segs.length) {
    const seg = segs[i];
    if (Array.isArray(node) && typeof seg === "number" && seg < node.length) {
      keys.push(seg);
      node = node[seg];
      i++;
      continue;
    }
    if (!isObject(node)) break;
    // The longest run of named segments that is a key: field ids may be dotted.
    let taken = 0;
    for (let n = segs.length - i; n >= 1 && taken === 0; n--) {
      const run = segs.slice(i, i + n);
      if (run.every((s) => typeof s === "string") && Object.hasOwn(node, run.join("."))) taken = n;
    }
    if (taken === 0) break;
    const key = segs.slice(i, i + taken).join(".");
    keys.push(key);
    node = node[key];
    i += taken;
  }
  return { keys, whole: i === segs.length };
}

function at(root: unknown, keys: readonly Key[]): unknown {
  let node = root;
  for (const k of keys) node = (node as Record<Key, unknown>)[k];
  return node;
}

const matches = (pattern: readonly string[], keys: readonly Key[]) =>
  pattern.length <= keys.length && pattern.every((p, i) => p === "*" || p === keys[i]);

/** The cut that answers one problem, or null when none does. */
function answer(m: Ruleset, problem: Problem): Ruleset | null {
  const { keys, whole } = locate(m, problem.path);
  const part = PARTS.filter((p) => matches(p.at, keys)).sort((a, b) => b.at.length - a.at.length)[0];
  if (part !== undefined) {
    const partKeys = keys.slice(0, part.at.length);
    if (part.answer === "cut") return cut(m, partKeys);
    if (problem.message.startsWith("unknown identifier")) return narrow(m, partKeys) ?? cut(m, partKeys);
    if (part.answer === "narrowOrCut") return cut(m, partKeys);
  }
  if (keys.length === 0) return null;
  // The node the problem names, or the one holding the required part an earlier cut took; a guard takes its part.
  const last = keys[keys.length - 1];
  return cut(m, whole && typeof last === "string" && GUARDS.has(last) ? keys.slice(0, -1) : keys);
}

/** The part at `keys` narrowed to the actor types it compiles for, or null when that is none or every one. */
function narrow(m: Ruleset, keys: readonly Key[]): Ruleset | null {
  const def = at(m, keys);
  if (!isObject(def)) return null;
  // A shared pool carries no actor types.
  if (keys[0] === "resources" && def.scope !== "entity") return null;
  const actors = m.entities.filter((e) => e.base === "actor").map((e) => e.id);
  const declared = def.entities;
  const candidates = Array.isArray(declared) ? declared.filter((id): id is string => typeof id === "string") : actors;
  // An expression's problem means the manifest validated, so a narrowing that does not validate broke something else
  // that needs the type (a layout row naming the resource on it): that type stays out of the narrowing.
  const keep = candidates.filter((id) => {
    const trial = withEntities(m, keys, [id]);
    if (!validateRuleset(trial).ok) return false;
    return !problemsOf(trial).some((p) => matches(keys.map(String), locate(trial, p.path).keys.map(String)));
  });
  return keep.length === 0 || keep.length === candidates.length ? null : withEntities(m, keys, keep);
}

function withEntities(m: Ruleset, keys: readonly Key[], entities: string[]): Ruleset {
  const out = structuredClone(m);
  (at(out, keys) as Record<string, unknown>).entities = entities;
  return out;
}

function cut(m: Ruleset, keys: readonly Key[]): Ruleset | null {
  if (keys.length === 0) return null;
  const out = structuredClone(m);
  const parent = at(out, keys.slice(0, -1)) as Node;
  const last = keys[keys.length - 1];
  if (Array.isArray(parent) && typeof last === "number") parent.splice(last, 1);
  else delete (parent as Record<string, unknown>)[String(last)];
  return out;
}
