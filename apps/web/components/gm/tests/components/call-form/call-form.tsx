"use client";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import type { LiveState } from "@inconsistable/core-schema";

import { MarkSwitches } from "@/components/gm/tests/components/mark-switches/mark-switches";
import { TestInputField } from "@/components/gm/tests/components/test-input/test-input";
import type { Send } from "@/hooks/use-table/use-table";
import { testWords, toInputs, type InputDraft } from "@/lib/test-inputs/test-inputs";

import { keepTakers, takers } from "./takers";

type CallFormProps = {
  state: LiveState;
  send: Send;
  /** Who rolls when the form opens (TRACK pre-selects the combatant it was opened from). */
  initialTargets?: string[];
  /** The Test selected when the form opens (PREP's Call button); an id the ruleset lacks falls back to the first. */
  initialTestId?: string;
  /** Runs once the call went through. */
  onCalled?: () => void;
};

// CALL A TEST: pick one of the ruleset's Tests, who rolls it and the number to beat. The target is hidden from the
// table unless the GM unticks that (docs/house-decisions.md #21).
export function CallForm({ state, send, initialTargets = [], initialTestId, onCalled }: CallFormProps) {
  const t = useTranslations("callForm");
  const [testId, setTestId] = useState(initialTestId ?? state.testDefs[0]?.id ?? "");
  const [draft, setDraft] = useState<InputDraft>({});
  // The header's sheet and the TESTS tab can both draw this form.
  const uid = useId();
  const [targets, setTargets] = useState<string[]>(() =>
    keepTakers({
      picked: initialTargets,
      actors: state.actors,
      def: state.testDefs.find((d) => d.id === testId) ?? state.testDefs[0],
    }),
  );
  const [hideTarget, setHideTarget] = useState(true);
  const [showOutcome, setShowOutcome] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const def = state.testDefs.find((d) => d.id === testId) ?? state.testDefs[0];
  const roster = useMemo(() => takers({ actors: state.actors, def }), [state.actors, def]);

  // TEST: switching Test clears what was filled in for the old one, and who can't take the new one.
  const handleTest = (e: ChangeEvent<HTMLSelectElement>) => {
    setTestId(e.target.value);
    setDraft({});
    setTargets((cur) =>
      keepTakers({ picked: cur, actors: state.actors, def: state.testDefs.find((d) => d.id === e.target.value) }),
    );
  };

  // WHO: adds or removes one character from the call.
  const handleTarget = (actorId: string) =>
    setTargets((cur) => (cur.includes(actorId) ? cur.filter((id) => id !== actorId) : [...cur, actorId]));

  // CALL TEST: checks the form, sends it, and shows the server's refusal if there is one.
  const handleCall = async (e: FormEvent) => {
    e.preventDefault();
    if (!def) return;
    const filled = toInputs({ def, draft });
    if (!filled.ok) return setError(t(filled.problem, { id: testWords(def).input(filled.id) }));
    if (targets.length === 0) return setError(t("pickWho"));
    const r = await send({
      type: "test.call",
      testId: def.id,
      actorIds: targets,
      inputs: filled.inputs,
      // A reported Test has no number to hide.
      hideTarget: !def.outcomes && hideTarget,
      showOutcome: !def.outcomes && hideTarget && showOutcome,
    });
    setError(r.ok ? null : r.error);
    if (r.ok) {
      setTargets([]);
      onCalled?.();
    }
  };

  if (!def) {
    return <p className="dim">{state.campaign.archived ? "" : t("pinRuleset")}</p>;
  }
  const words = testWords(def);
  return (
    <form className="card" onSubmit={handleCall}>
      <h2 className="head">{t("title")}</h2>
      <div className="row" style={{ alignItems: "end" }}>
        <label>
          {t("test")}
          <select id={`${uid}-test`} value={def.id} onChange={handleTest}>
            {state.testDefs.map((d) => (
              <option key={d.id} value={d.id}>
                {testWords(d).test} ({d.outcomes ? t("reported") : d.dice})
              </option>
            ))}
          </select>
        </label>
        {def.inputs.map((input) => (
          <TestInputField
            key={input.id}
            id={`${uid}-input-${input.id}`}
            input={input}
            words={words}
            value={draft[input.id]}
            onChange={(v) => setDraft({ ...draft, [input.id]: v })}
          />
        ))}
      </div>
      <MarkSwitches
        marks={def.marks ?? []}
        on={(id) => draft[id] === true}
        onChange={(id, on) => setDraft({ ...draft, [id]: on })}
        idPrefix="call-mark"
      />
      <div className="stack">
        <span className="small">{t("whoRolls")}</span>
        <div className="row" role="group" aria-label={t("whoRolls")}>
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
          {roster.length === 0 && (
            <span className="dim">
              {state.actors.some((a) => a.entity !== "") ? t("nobodyTakes") : t("noCharacter")}
            </span>
          )}
        </div>
      </div>
      {!def.outcomes && (
        <div className="row">
          <label className="row" style={{ minHeight: 44 }}>
            <input
              type="checkbox"
              checked={hideTarget}
              onChange={(e) => setHideTarget(e.target.checked)}
              style={{ minHeight: 24 }}
            />
            {t("hideTarget")}
          </label>
          {hideTarget && (
            <label className="row" style={{ minHeight: 44 }}>
              <input
                type="checkbox"
                checked={showOutcome}
                onChange={(e) => setShowOutcome(e.target.checked)}
                style={{ minHeight: 24 }}
              />
              {t("showOutcome")}
            </label>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" style={{ justifySelf: "start" }}>
        {t("callTest")}
      </button>
    </form>
  );
}
