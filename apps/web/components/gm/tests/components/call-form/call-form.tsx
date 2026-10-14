"use client";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import type { LiveState, TestDef, TestInputs } from "@inconsistable/core-schema";
import { ScalarType } from "@inconsistable/rules-engine";

import type { Send } from "@/hooks/use-table/use-table";

type CallFormProps = {
  state: LiveState;
  send: Send;
  /** Who rolls when the form opens (TRACK pre-selects the combatant it was opened from). */
  initialTargets?: string[];
  /** Runs once the call went through. */
  onCalled?: () => void;
};

// What the form holds for one input while it is being filled in; the Test's declared type decides how it is sent.
type Draft = Record<string, string | boolean>;

// The text typed into one input ("" while it holds a checkbox or nothing).
const textOf = (draft: Draft, id: string): string => {
  const v = draft[id];
  return typeof v === "string" ? v : "";
};

// The call as the API takes it, or why the form can't send it yet.
function toInputs({ def, draft }: { def: TestDef; draft: Draft }): TestInputs | string {
  const out: TestInputs = {};
  for (const input of def.inputs) {
    const v = draft[input.id];
    const type = ScalarType.safeParse(input.type);
    if (type.success && type.data === "bool") out[input.id] = v === true;
    else if (type.success && type.data === "int") {
      if (typeof v !== "string" || v.trim() === "" || !Number.isSafeInteger(Number(v)))
        return `Fill in ${input.id} with a whole number`;
      out[input.id] = Number(v);
    } else {
      if (typeof v !== "string" || v.trim() === "") return `Fill in ${input.id}`;
      out[input.id] = v.trim();
    }
  }
  return out;
}

// CALL A TEST: pick one of the ruleset's Tests, who rolls it and the number to beat. The target is hidden from the
// table unless the GM unticks that (docs/house-decisions.md #21).
export function CallForm({ state, send, initialTargets = [], onCalled }: CallFormProps) {
  const [testId, setTestId] = useState(state.testDefs[0]?.id ?? "");
  const [draft, setDraft] = useState<Draft>({});
  const [targets, setTargets] = useState<string[]>(initialTargets);
  const [hideTarget, setHideTarget] = useState(true);
  const [showOutcome, setShowOutcome] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const def = state.testDefs.find((d) => d.id === testId) ?? state.testDefs[0];
  const roster = useMemo(() => state.actors.filter((a) => a.entity !== ""), [state.actors]);

  // TEST: switching Test clears what was filled in for the old one.
  const handleTest = (e: ChangeEvent<HTMLSelectElement>) => {
    setTestId(e.target.value);
    setDraft({});
  };

  // WHO: adds or removes one character from the call.
  const handleTarget = (actorId: string) =>
    setTargets((cur) => (cur.includes(actorId) ? cur.filter((id) => id !== actorId) : [...cur, actorId]));

  // CALL TEST: checks the form, sends it, and shows the server's refusal if there is one.
  const handleCall = async (e: FormEvent) => {
    e.preventDefault();
    if (!def) return;
    const inputs = toInputs({ def, draft });
    if (typeof inputs === "string") return setError(inputs);
    if (targets.length === 0) return setError("Pick who rolls");
    const r = await send({
      type: "test.call",
      testId: def.id,
      actorIds: targets,
      inputs,
      hideTarget,
      showOutcome: hideTarget && showOutcome,
    });
    setError(r.ok ? null : r.error);
    if (r.ok) {
      setTargets([]);
      onCalled?.();
    }
  };

  if (!def) {
    return <p className="dim">{state.campaign.archived ? "" : "Pin a ruleset with Tests to call one from here."}</p>;
  }
  return (
    <form className="card" onSubmit={handleCall}>
      <h2 className="head">Call a Test</h2>
      <div className="row" style={{ alignItems: "end" }}>
        <label>
          Test
          <select id="call-test" value={def.id} onChange={handleTest}>
            {state.testDefs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} ({d.dice})
              </option>
            ))}
          </select>
        </label>
        {def.inputs.map((input) =>
          input.type === "bool" ? (
            <label key={input.id} className="row" style={{ minHeight: 44 }}>
              <input
                type="checkbox"
                checked={draft[input.id] === true}
                onChange={(e) => setDraft({ ...draft, [input.id]: e.target.checked })}
                style={{ minHeight: 24 }}
              />
              {input.id}
            </label>
          ) : (
            <label key={input.id}>
              {input.id}
              {input.options ? (
                <select
                  id={`call-input-${input.id}`}
                  value={textOf(draft, input.id)}
                  onChange={(e) => setDraft({ ...draft, [input.id]: e.target.value })}
                >
                  <option value="">Pick…</option>
                  {input.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`call-input-${input.id}`}
                  inputMode={input.type === "int" ? "numeric" : "text"}
                  value={textOf(draft, input.id)}
                  onChange={(e) => setDraft({ ...draft, [input.id]: e.target.value })}
                  style={{ width: input.type === "int" ? 96 : 160 }}
                />
              )}
            </label>
          ),
        )}
      </div>
      <div className="stack">
        <span className="small">Who rolls</span>
        <div className="row" role="group" aria-label="Who rolls">
          {roster.map((a) => (
            <button
              key={a.id}
              type="button"
              className="btn"
              aria-pressed={targets.includes(a.id)}
              onClick={() => handleTarget(a.id)}
            >
              {a.name}
            </button>
          ))}
          {roster.length === 0 && <span className="dim">No character is built for this ruleset yet.</span>}
        </div>
      </div>
      <div className="row">
        <label className="row" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={hideTarget}
            onChange={(e) => setHideTarget(e.target.checked)}
            style={{ minHeight: 24 }}
          />
          Hide the number to beat from the table
        </label>
        {hideTarget && (
          <label className="row" style={{ minHeight: 44 }}>
            <input
              type="checkbox"
              checked={showOutcome}
              onChange={(e) => setShowOutcome(e.target.checked)}
              style={{ minHeight: 24 }}
            />
            Tell them success or failure
          </label>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" style={{ justifySelf: "start" }}>
        Call Test
      </button>
    </form>
  );
}
