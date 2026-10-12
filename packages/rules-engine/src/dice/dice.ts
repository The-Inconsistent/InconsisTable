import { z } from "zod";

// The app rolls only on random tables, or Tests when a ruleset opts in (docs/house-decisions.md #1). Every cap
// below bounds what a manifest or a GM can ask the server to roll.
export const MAX_DICE = 100;
export const MAX_SIDES = 1000;
export const MAX_EXPLODE_DEPTH = 10;
export const MAX_TERMS = 20;
export const MAX_CONSTANT = 10_000;

export const KeepWhich = z.enum(["highest", "lowest"]);
export type KeepWhich = z.infer<typeof KeepWhich>;

/** `d66` reads two d6 as tens and units (11–66); `F` is a Fudge die (−1, 0, +1). */
export type Die = number | "d66" | "F";

export type DiceTerm =
  | { kind: "const"; sign: 1 | -1; value: number }
  | {
      kind: "dice";
      sign: 1 | -1;
      count: number;
      die: Die;
      keep: { which: KeepWhich; n: number } | null;
      explode: boolean;
      /** `>=T`: the term counts kept faces at or above T instead of summing them. */
      successAt: number | null;
    };

export interface DiceExpr {
  notation: string;
  terms: DiceTerm[];
}

export class DiceError extends Error {
  override name = "DiceError";
}

/** Returns an integer in [1, sides]. Injectable so tests and previews are deterministic. */
export type Rng = (sides: number) => number;

export interface TermRoll {
  notation: string;
  /** Every face rolled, explosions included, in roll order. */
  faces: number[];
  /** Parallel to `faces`: false for a face dropped by kh/kl. */
  kept: boolean[];
  /** Signed contribution to the total. */
  value: number;
}

export interface DiceRoll {
  notation: string;
  faces: number[];
  total: number;
  terms: TermRoll[];
}

export type ParseDiceResult = { ok: true; dice: DiceExpr } | { ok: false; error: string };

class Cursor {
  pos = 0;
  readonly src: string;
  constructor(src: string) {
    this.src = src;
  }
  skipSpace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] ?? "")) this.pos++;
  }
  eat(text: string): boolean {
    this.skipSpace();
    if (!this.src.startsWith(text, this.pos)) return false;
    this.pos += text.length;
    return true;
  }
  int(): number | null {
    this.skipSpace();
    const m = /^[0-9]+/.exec(this.src.slice(this.pos));
    if (m === null) return null;
    this.pos += m[0].length;
    return Number(m[0]);
  }
  done(): boolean {
    this.skipSpace();
    return this.pos >= this.src.length;
  }
}

function parseTerm(c: Cursor, sign: 1 | -1): DiceTerm {
  const lead = c.int();
  c.skipSpace();
  if (!(c.src[c.pos] === "d" || c.src[c.pos] === "D")) {
    if (lead === null) throw new DiceError(`expected a number or dice at ${c.pos}`);
    if (lead > MAX_CONSTANT) throw new DiceError(`constant ${lead} is over ${MAX_CONSTANT}`);
    return { kind: "const", sign, value: lead };
  }
  c.pos++;
  const count = lead ?? 1;
  if (count < 1 || count > MAX_DICE) throw new DiceError(`dice count must be 1–${MAX_DICE}, got ${count}`);
  let die: Die;
  if (c.src[c.pos] === "F") {
    c.pos++;
    die = "F";
  } else if (c.src.startsWith("66", c.pos) && !/[0-9]/.test(c.src[c.pos + 2] ?? "")) {
    c.pos += 2;
    die = "d66";
  } else {
    // No space allowed inside `dX`.
    const m = /^[0-9]+/.exec(c.src.slice(c.pos));
    if (m === null) throw new DiceError(`expected sides after "d" at ${c.pos}`);
    c.pos += m[0].length;
    const sides = Number(m[0]);
    if (sides < 1 || sides > MAX_SIDES) throw new DiceError(`a die must have 1–${MAX_SIDES} sides, got ${sides}`);
    die = sides;
  }
  let keep: { which: KeepWhich; n: number } | null = null;
  let explode = false;
  let successAt: number | null = null;
  for (;;) {
    if (c.eat("kh") || c.eat("kl")) {
      if (keep !== null) throw new DiceError("only one kh/kl per term");
      const which: KeepWhich = c.src.slice(c.pos - 2, c.pos) === "kh" ? "highest" : "lowest";
      const n = c.int();
      if (n === null || n < 1 || n > count) throw new DiceError(`keep must be 1–${count}`);
      keep = { which, n };
    } else if (c.eat("!")) {
      if (explode) throw new DiceError("only one ! per term");
      // A d1 always rolls its max and would explode forever; F and d66 have no single top face to chain on.
      if (die === 1 || die === "F" || die === "d66") throw new DiceError(`cannot explode d${die}`);
      explode = true;
    } else if (c.eat(">=")) {
      if (successAt !== null) throw new DiceError("only one >= per term");
      if (die === "F") throw new DiceError("cannot count successes on dF");
      const t = c.int();
      if (t === null) throw new DiceError(`expected a target after ">=" at ${c.pos}`);
      successAt = t;
    } else break;
  }
  return { kind: "dice", sign, count, die, keep, explode, successAt };
}

/** Parse dice notation: `NdX`, `+`/`-` constants and dice, `kh N`/`kl N`, `!`, `>=T`, `d66`, `dF`. */
export function parseDice(notation: string): ParseDiceResult {
  try {
    const c = new Cursor(notation);
    const terms: DiceTerm[] = [parseTerm(c, 1)];
    while (!c.done()) {
      let sign: 1 | -1;
      if (c.eat("+")) sign = 1;
      else if (c.eat("-")) sign = -1;
      else throw new DiceError(`unexpected "${c.src[c.pos] ?? ""}" at ${c.pos}`);
      terms.push(parseTerm(c, sign));
      if (terms.length > MAX_TERMS) throw new DiceError(`more than ${MAX_TERMS} terms`);
    }
    if (!terms.some((t) => t.kind === "dice")) throw new DiceError("notation has no dice");
    return { ok: true, dice: { notation: notation.trim(), terms } };
  } catch (err) {
    if (err instanceof DiceError) return { ok: false, error: err.message };
    throw err;
  }
}

export function formatTerm(term: DiceTerm): string {
  if (term.kind === "const") return String(term.value);
  const die = term.die === "d66" ? "66" : String(term.die);
  const keep = term.keep === null ? "" : `${term.keep.which === "highest" ? "kh" : "kl"}${term.keep.n}`;
  const success = term.successAt === null ? "" : `>=${term.successAt}`;
  return `${term.count}d${die}${keep}${term.explode ? "!" : ""}${success}`;
}

/** Uniform integer in [1, sides] from crypto.getRandomValues, with rejection sampling so no face is favoured. */
export const cryptoRng: Rng = (sides) => {
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const v = buf[0] ?? 0;
    if (v < limit) return (v % sides) + 1;
  }
};

/** A deterministic rng (mulberry32) for tests and previews. Never for a roll that counts. */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return (sides) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unit = ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    return 1 + Math.floor(unit * sides);
  };
}

function draw(rng: Rng, sides: number): number {
  const v = rng(sides);
  if (!Number.isInteger(v) || v < 1 || v > sides) throw new DiceError(`rng returned ${v} for a d${sides}`);
  return v;
}

function rollOne(rng: Rng, die: Die): number {
  if (die === "F") return draw(rng, 3) - 2;
  if (die === "d66") return draw(rng, 6) * 10 + draw(rng, 6);
  return draw(rng, die);
}

function rollTerm(term: Extract<DiceTerm, { kind: "dice" }>, rng: Rng): TermRoll {
  const faces: number[] = [];
  for (let i = 0; i < term.count; i++) {
    let face = rollOne(rng, term.die);
    faces.push(face);
    // `!` is refused on F and d66 at parse, so the die is numeric here.
    for (let depth = 0; term.explode && face === term.die && depth < MAX_EXPLODE_DEPTH; depth++) {
      face = rollOne(rng, term.die);
      faces.push(face);
    }
  }
  const kept = faces.map(() => true);
  if (term.keep !== null) {
    const order = faces.map((v, i) => ({ v, i }));
    // Stable: equal faces keep roll order, so the same rolls always drop the same dice.
    order.sort((a, b) => (term.keep?.which === "highest" ? b.v - a.v : a.v - b.v) || a.i - b.i);
    kept.fill(false);
    for (const { i } of order.slice(0, term.keep.n)) kept[i] = true;
  }
  const keptFaces = faces.filter((_, i) => kept[i]);
  const raw =
    term.successAt === null
      ? keptFaces.reduce((s, v) => s + v, 0)
      : keptFaces.filter((v) => v >= (term.successAt ?? Infinity)).length;
  return { notation: formatTerm(term), faces, kept, value: term.sign * raw };
}

/** Roll a notation. Throws DiceError on bad notation or a breached cap. */
export function rollDice({ notation, rng = cryptoRng }: { notation: string; rng?: Rng }): DiceRoll {
  const parsed = parseDice(notation);
  if (!parsed.ok) throw new DiceError(parsed.error);
  const terms = parsed.dice.terms.map((t): TermRoll =>
    t.kind === "const" ? { notation: formatTerm(t), faces: [], kept: [], value: t.sign * t.value } : rollTerm(t, rng),
  );
  return {
    notation: parsed.dice.notation,
    faces: terms.flatMap((t) => t.faces),
    total: terms.reduce((s, t) => s + t.value, 0),
    terms,
  };
}
