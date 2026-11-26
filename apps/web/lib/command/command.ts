import type { ActionInput, CombatVisibility } from "@inconsistable/core-schema";

// The GM's command line (house decision #100): a short order typed on the tracker, parsed into one of the existing
// actions and said back as a sentence before it is sent. A screen feature only: the server decides as it does for a tap.

/** The verbs an order may use; the words that call each are the platform's own, in the messages (`command.words`). */
export const COMMAND_VERBS = [
  "hit",
  "heal",
  "shock",
  "recover",
  "next",
  "hold",
  "back",
  "begin",
  "mob",
  "reveal",
  "hide",
  "go",
  "seize",
  "aware",
  "ambush",
  "remove",
] as const;
export type CommandVerb = (typeof COMMAND_VERBS)[number];
export type CommandWords = Readonly<Record<CommandVerb, readonly string[]>>;

/**
 * The orders on one fighter's turn that the `sides` turn order's ops do (house decision #161), as its panel's buttons:
 * go acts out of order (JUST GO), seize pays to act out of turn, ambush bars a first turn, aware lifts that bar again.
 */
const SIDE_VERBS = {
  go: (id: string) => ({ op: "pick", input: { id, force: true } }),
  seize: (id: string) => ({ op: "seize", input: { id } }),
  ambush: (id: string) => ({ op: "bar", input: { id, barred: true } }),
  aware: (id: string) => ({ op: "bar", input: { id, barred: false } }),
} as const;
export type SideVerb = keyof typeof SIDE_VERBS;

/** Each verb's words from a space-separated list per verb (the messages' `command.words`), lower case. */
export function commandWords(say: (verb: CommandVerb) => string): CommandWords {
  const out = {} as Record<CommandVerb, string[]>;
  for (const v of COMMAND_VERBS) out[v] = say(v).toLowerCase().split(/\s+/).filter(Boolean);
  return out;
}

/** One combatant an order can name. */
export type Fighter = { combatantId: string; actorId: string; name: string };

export type CommandTable = {
  words: CommandWords;
  fighters: readonly Fighter[];
  /** The combatant an order without a name is for: the tracker's selected one. */
  selected: Fighter | null;
  conditions: readonly { id: string; label: string }[];
  pools: readonly { id: string; label: string }[];
  /** The ruleset's `health.harm` resources (with their labels), or null when it has none. */
  harm: { wounds: { id: string; label: string }; shock: { id: string; label: string } | null; mob: boolean } | null;
  /** The ruleset's first health track's resource, when it has `health.tracks` and no harm. */
  track: { id: string; label: string } | null;
  /** The turn order is `sides`: next, hold and begin are its ops. */
  sides: boolean;
};

/** What an order says, for the screen to word before it is sent. */
export type Said =
  | { kind: "change"; name: string; label: string; by: number }
  | { kind: "condition"; name: string; label: string; on: boolean }
  | { kind: "turn"; verb: "next" | "hold" | "back" | "begin" }
  | { kind: "mob"; name: string; members: number }
  | { kind: "visibility"; name: string; visibility: CombatVisibility }
  | { kind: "side"; verb: SideVerb; name: string }
  | { kind: "remove"; name: string }
  | { kind: "pool"; label: string; by: number };

/** Why an order does not parse; nothing is sent. */
export type Why =
  | { kind: "unknown" }
  | { kind: "noTarget" }
  | { kind: "noMatch"; words: string }
  | { kind: "ambiguous"; names: string }
  | { kind: "noCondition"; words: string }
  | { kind: "needsCount" }
  | { kind: "notHere" };

export type Order = { ok: true; said: Said; action: ActionInput } | { ok: false; why: Why };

const lower = (s: string) => s.toLowerCase();
const squash = (s: string) => lower(s).replace(/\s+/g, "");

/** The one fighter the words name by prefix (an exact name first), the selected one without words, or why not. */
function resolve(words: readonly string[], table: CommandTable): Fighter | Why {
  if (words.length === 0) return table.selected ?? { kind: "noTarget" };
  const q = words.join(" ");
  const exact = table.fighters.filter((f) => lower(f.name) === q);
  if (exact.length === 1 && exact[0]) return exact[0];
  const hits = table.fighters.filter(
    (f) =>
      lower(f.name).startsWith(q) ||
      lower(f.name)
        .split(/[\s×()]+/)
        .some((w) => w !== "" && w.startsWith(q)),
  );
  if (hits.length === 1 && hits[0]) return hits[0];
  if (hits.length > 1) return { kind: "ambiguous", names: hits.map((f) => f.name).join(", ") };
  return { kind: "noMatch", words: q };
}

const isWhy = (v: Fighter | Why): v is Why => "kind" in v;

/** A change to the named fighter's harm: wounds (hit, heal) or shock (shock, recover), or the track's points. */
function change(verb: "hit" | "heal" | "shock" | "recover", n: number, f: Fighter, table: CommandTable): Order {
  const by = verb === "heal" || verb === "recover" ? -n : n;
  const harm = table.harm;
  if (harm !== null) {
    const res = verb === "hit" || verb === "heal" ? harm.wounds : harm.shock;
    if (res === null) return { ok: false, why: { kind: "notHere" } };
    const key = res === harm.wounds ? "wounds" : "shock";
    return {
      ok: true,
      said: { kind: "change", name: f.name, label: res.label, by },
      action: { type: "rule.op", primitive: "health.harm", op: "hit", input: { actorId: f.actorId, [key]: by } },
    };
  }
  if (table.track === null || verb === "shock" || verb === "recover") return { ok: false, why: { kind: "notHere" } };
  // A track counts down: a hit takes points, healing gives them back.
  return {
    ok: true,
    said: { kind: "change", name: f.name, label: table.track.label, by: -by },
    action: {
      type: "rule.op",
      primitive: "health.tracks",
      op: verb === "hit" ? "damage" : "heal",
      input: { actorId: f.actorId, amount: n },
    },
  };
}

/**
 * The order the text says, or why it does not parse; null for nothing typed. Its shapes: `<name> <verb> [n]` in any
 * order (hit, heal, shock, recover: 1 when no number), `<name> +n` or `-n` (hit or heal), `+<condition> [name]` and
 * `-<condition> [name]`, `<name> mob n`, `reveal|hide <name>`, `go|seize|aware|ambush|remove <name>`, `<pool> +n|-n`,
 * and `next`, `hold`, `back`, `begin` alone. A name may be its first letters; no name is the selected combatant.
 */
export function parseOrder({ text, table }: { text: string; table: CommandTable }): Order | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean).map(lower);
  if (tokens.length === 0) return null;
  let verb: CommandVerb | null = null;
  let amount: number | null = null;
  let signed = false;
  let condition: { on: boolean; word: string } | null = null;
  const words: string[] = [];
  for (const tok of tokens) {
    // A plain number before the verb is part of a name ("Ogre 1"); after it, or signed, it is the amount.
    if (amount === null && (/^[+-]\d{1,4}$/.test(tok) || (verb !== null && /^\d{1,4}$/.test(tok)))) {
      amount = Number(tok);
      signed = /^[+-]/.test(tok);
      continue;
    }
    if (condition === null && /^[+-]\D/.test(tok)) {
      condition = { on: tok.startsWith("+"), word: tok.slice(1) };
      continue;
    }
    const v: CommandVerb | undefined =
      verb === null ? COMMAND_VERBS.find((x) => table.words[x].includes(tok)) : undefined;
    if (v !== undefined) {
      verb = v;
      continue;
    }
    words.push(tok);
  }
  const fail = (why: Why): Order => ({ ok: false, why });
  // A verb that takes no number reads a plain one after it as the end of the name ("reveal ogre 2").
  const named = verb === "reveal" || verb === "hide" || verb === "remove" || (verb !== null && verb in SIDE_VERBS);
  if ((named || condition !== null) && amount !== null && !signed) words.push(String(amount));

  if (verb === "next" || verb === "hold" || verb === "back" || verb === "begin") {
    if (verb === "back") return { ok: true, said: { kind: "turn", verb }, action: { type: "event.turnBack" } };
    if (verb === "next" && !table.sides)
      return { ok: true, said: { kind: "turn", verb }, action: { type: "turn.next" } };
    if (!table.sides) return fail({ kind: "notHere" });
    return {
      ok: true,
      said: { kind: "turn", verb },
      action: { type: "rule.op", primitive: "initiative.sides", op: verb, input: {} },
    };
  }
  if (condition !== null) {
    const f = resolve(words, table);
    if (isWhy(f)) return fail(f);
    const word = condition.word;
    const found = table.conditions.filter((c) => squash(c.label).startsWith(word) || c.id.toLowerCase() === word);
    const c = found.length === 1 ? found[0] : found.find((x) => squash(x.label) === word);
    if (c === undefined)
      return fail(
        found.length > 1
          ? { kind: "ambiguous", names: found.map((x) => x.label).join(", ") }
          : { kind: "noCondition", words: word },
      );
    return {
      ok: true,
      said: { kind: "condition", name: f.name, label: c.label, on: condition.on },
      action: condition.on
        ? { type: "condition.add", actorId: f.actorId, condition: c.id }
        : { type: "condition.remove", actorId: f.actorId, condition: c.id },
    };
  }
  if (verb === "hit" || verb === "heal" || verb === "shock" || verb === "recover") {
    const f = resolve(words, table);
    if (isWhy(f)) return fail(f);
    return change(verb, Math.abs(amount ?? 1), f, table);
  }
  if (verb === "mob") {
    if (amount === null || amount < 0) return fail({ kind: "needsCount" });
    if (table.harm?.mob !== true) return fail({ kind: "notHere" });
    const f = resolve(words, table);
    if (isWhy(f)) return fail(f);
    return {
      ok: true,
      said: { kind: "mob", name: f.name, members: amount },
      action: {
        type: "rule.op",
        primitive: "health.harm",
        op: "muster",
        input: { actorId: f.actorId, members: amount },
      },
    };
  }
  if (verb === "reveal" || verb === "hide") {
    const f = resolve(words, table);
    if (isWhy(f)) return fail(f);
    const visibility = verb === "reveal" ? "full" : "hidden";
    return {
      ok: true,
      said: { kind: "visibility", name: f.name, visibility },
      action: { type: "encounter.setVisibility", combatantId: f.combatantId, visibility },
    };
  }
  if (verb === "go" || verb === "seize" || verb === "aware" || verb === "ambush") {
    if (!table.sides) return fail({ kind: "notHere" });
    const f = resolve(words, table);
    if (isWhy(f)) return fail(f);
    const { op, input } = SIDE_VERBS[verb](f.actorId);
    return {
      ok: true,
      said: { kind: "side", verb, name: f.name },
      action: { type: "rule.op", primitive: "initiative.sides", op, input },
    };
  }
  if (verb === "remove") {
    const f = resolve(words, table);
    if (isWhy(f)) return fail(f);
    return {
      ok: true,
      said: { kind: "remove", name: f.name },
      action: { type: "encounter.remove", combatantId: f.combatantId },
    };
  }
  if (amount !== null && signed) {
    const q = words.join("");
    const pools = q === "" ? [] : table.pools.filter((p) => squash(p.label).startsWith(q));
    const f = resolve(words, table);
    if (pools.length === 1 && pools[0] && isWhy(f)) {
      const p = pools[0];
      return {
        ok: true,
        said: { kind: "pool", label: p.label, by: amount },
        action: {
          type: "rule.op",
          primitive: "resource.capped",
          op: "adjustPool",
          input: { resource: p.id, delta: amount },
        },
      };
    }
    if (isWhy(f)) return fail(f);
    return change(amount < 0 ? "heal" : "hit", Math.abs(amount), f, table);
  }
  return fail({ kind: "unknown" });
}
