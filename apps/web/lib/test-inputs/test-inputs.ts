import type { TestDef, TestInputs } from "@inconsistable/core-schema";
import { ScalarType } from "@inconsistable/rules-engine";

/** One input a Test declares: what the call form asks for. */
export type TestInput = TestDef["inputs"][number];

/** What a form holds for a Test's inputs while they are filled in: typed text, or a ticked switch. */
export type InputDraft = Record<string, string | boolean>;

/** The call as the API takes it, or which input can't be sent yet and why (the form words it). */
export type Filled = { ok: true; inputs: TestInputs } | { ok: false; problem: "wholeNumber" | "fillIn"; id: string };

type Read = { ok: true; value: string | number | boolean } | { ok: false; problem: "wholeNumber" | "fillIn" };

// One input as `test.call` takes it (the server's CheckInputs): a switch is always filled (off when left out), a number
// is a whole number, a text is not empty and, for a choice, one of its choices.
function readInput(input: TestInput, v: string | boolean | undefined): Read {
  const type = ScalarType.safeParse(input.type);
  if (type.success && type.data === "bool") return { ok: true, value: v === true };
  if (type.success && type.data === "int") {
    if (typeof v !== "string" || v.trim() === "" || !Number.isSafeInteger(Number(v)))
      return { ok: false, problem: "wholeNumber" };
    return { ok: true, value: Number(v) };
  }
  if (typeof v !== "string" || v.trim() === "") return { ok: false, problem: "fillIn" };
  if (input.options && !input.options.includes(v.trim())) return { ok: false, problem: "fillIn" };
  return { ok: true, value: v.trim() };
}

/** Every input the Test declares, read from the draft; the first one that can't be sent stops it. */
export function toInputs({ def, draft }: { def: TestDef; draft: InputDraft }): Filled {
  const out: TestInputs = {};
  for (const input of def.inputs) {
    const r = readInput(input, draft[input.id]);
    if (!r.ok) return { ok: false, problem: r.problem, id: input.id };
    out[input.id] = r.value;
  }
  return { ok: true, inputs: out };
}

/** Values a prepared line keeps, as the call form's draft holds them. */
export function draftOf(inputs: TestInputs): InputDraft {
  return Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, typeof v === "boolean" ? v : String(v)]));
}

/** The inputs a prepared line leaves for the GM to fill in before it can be called; a switch is never one of them. */
export function missingInputs({ def, inputs }: { def: TestDef; inputs: TestInputs }): TestInput[] {
  const draft = draftOf(inputs);
  return def.inputs.filter((input) => !readInput(input, draft[input.id]).ok);
}
