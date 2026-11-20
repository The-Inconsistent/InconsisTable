"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";

import {
  CombatVisibility,
  ExitLine,
  PickLine,
  PoolLine,
  RevealLine,
  RosterLine,
  TestLine,
  TestTakers,
  type CodexEntry,
  type LiveState,
  type PrepKind,
  type PrepLine,
  type TestInputs,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { takers } from "@/components/gm/tests/components/call-form/takers";
import { MarkSwitches } from "@/components/gm/tests/components/mark-switches/mark-switches";
import { pickableFields, rowName, rowsOf } from "@/lib/entry-fields/entry-fields";
import { canMob } from "@/lib/harm/harm";
import type { Spawnable } from "@/lib/scene-prep/scene-prep";
import { testWords } from "@/lib/test-inputs/test-inputs";

import { MAX_OUTCOMES, newLine } from "./constants";

type LineFormProps = {
  kind: PrepKind;
  /** The line being changed; absent for a new one. */
  line?: PrepLine;
  scene: CodexEntry;
  entries: readonly CodexEntry[];
  state: Pick<LiveState, "testDefs" | "pools" | "actors">;
  ruleset: Ruleset | null;
  spawnable: Spawnable;
  onSave: (line: PrepLine) => void;
  onCancel: () => void;
};

const SCHEMAS = {
  roster: RosterLine,
  tests: TestLine,
  pools: PoolLine,
  exits: ExitLine,
  reveals: RevealLine,
  picks: PickLine,
};

// One prepared line being written: the pickers for what it names (a creature, a Test and its inputs, a pool, a scene, an
// entry), how it is sent, and the GM's label and note. SAVE is offered once the line has the shape the api takes.
export function LineForm({ kind, line, scene, entries, state, ruleset, spawnable, onSave, onCancel }: LineFormProps) {
  const t = useTranslations("prep");
  const [draft, setDraft] = useState<PrepLine>(() => line ?? newLine({ kind, state, entries, scene, spawnable }));
  const valid = SCHEMAS[kind].safeParse(draft).success;
  // A draft is one of five shapes; each field below belongs to the kind the form was opened for.
  const d = draft as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => setDraft({ ...d, ...patch } as PrepLine);

  // A text field of the draft; an empty optional text is left out.
  const handleText = (field: string, optional: boolean) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { [field]: _old, ...rest } = d;
    setDraft((optional && e.target.value === "" ? rest : { ...rest, [field]: e.target.value }) as PrepLine);
  };

  // SAVE: hands the finished line up; the scene saves its whole document.
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) onSave(draft);
  };

  return (
    <form className="card stack" onSubmit={handleSubmit} aria-label={t(`add.${kind}`)} style={{ minWidth: 0 }}>
      {kind === "roster" && <RosterFields d={d} set={set} ruleset={ruleset} spawnable={spawnable} />}
      {kind === "tests" && <TestFields d={d} set={set} state={state} />}
      {kind === "pools" && (
        <>
          <label className="stack">
            {t("form.pool")}
            <select id="line-pool" value={String(d.pool ?? "")} onChange={(e) => set({ pool: e.target.value })}>
              {!state.pools.some((p) => p.id === d.pool) && (
                <option value={String(d.pool ?? "")}>{String(d.pool)}</option>
              )}
              {state.pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="stack">
            {t("form.amount")}
            <input
              id="line-amount"
              type="number"
              step={1}
              value={Number.isFinite(d.amount) ? String(d.amount) : ""}
              onChange={(e) => set({ amount: e.target.valueAsNumber })}
            />
            <span className="small dim">{t("form.amountHint")}</span>
          </label>
          <label className="stack">
            {t("form.text")}
            <input id="line-text" value={String(d.text ?? "")} onChange={handleText("text", false)} maxLength={500} />
          </label>
        </>
      )}
      {kind === "exits" && (
        <label className="stack">
          {t("form.scene")}
          <select id="line-scene" value={String(d.sceneId ?? "")} onChange={(e) => set({ sceneId: e.target.value })}>
            <option value="">{t("form.pick")}</option>
            {entries
              .filter((e) => e.kind === "scene" && e.id !== scene.id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {kind === "reveals" && <RevealField d={d} set={set} entries={entries} scene={scene} />}
      {kind === "picks" && <PickFields d={d} set={set} entries={entries} scene={scene} ruleset={ruleset} />}
      <label className="stack">
        {kind === "exits" ? t("form.exitLabel") : t("form.label")}
        <input
          id="line-label"
          value={String(d.label ?? "")}
          onChange={handleText("label", kind !== "exits")}
          maxLength={80}
        />
        {kind === "roster" && <span className="small dim">{t("form.rosterLabelHint")}</span>}
      </label>
      <label className="stack">
        {t("form.note")}
        <textarea
          id="line-note"
          rows={2}
          value={String(d.note ?? "")}
          onChange={handleText("note", true)}
          maxLength={500}
        />
      </label>
      <div className="row">
        <button className="btn primary" disabled={!valid}>
          {t("saveLine")}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}

type FieldsProps = { d: Record<string, unknown>; set: (patch: Record<string, unknown>) => void };

// A roster line: the creature (by pack and key), how many, as a mob when the ruleset has mobs, how the table sees them.
function RosterFields({ d, set, ruleset, spawnable }: FieldsProps & { ruleset: Ruleset | null; spawnable: Spawnable }) {
  const t = useTranslations("prep");
  const tCreatures = useTranslations("creatures");
  const tVisibility = useTranslations("combatVisibility");
  const value = `${String(d.pack ?? "")}/${String(d.key ?? "")}`;
  const picked = spawnable.entries.find((e) => `${e.pack}/${e.key}` === value);
  const mobbable = picked !== undefined && canMob({ ruleset, type: picked.type });

  // The creature picker: the pack's slug and the entry's key are what the line keeps.
  const handlePick = (e: ChangeEvent<HTMLSelectElement>) => {
    const entry = spawnable.entries.find((x) => `${x.pack}/${x.key}` === e.target.value);
    if (entry) set({ pack: entry.pack, key: entry.key });
  };

  // AS A MOB OF: blank places them one by one.
  const handleMob = (e: ChangeEvent<HTMLInputElement>) => {
    const { mob: _old, ...rest } = d;
    set(
      Number.isFinite(e.target.valueAsNumber) ? { ...rest, mob: e.target.valueAsNumber } : { ...rest, mob: undefined },
    );
  };

  return (
    <>
      <label className="stack">
        {t("form.creature")}
        <select id="line-creature" value={value} onChange={handlePick}>
          {!picked && <option value={value}>{String(d.key ?? "")}</option>}
          {spawnable.entries.map((e) => (
            <option key={`${e.pack}/${e.key}`} value={`${e.pack}/${e.key}`}>
              {e.name} · {e.pack}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <label className="stack">
          {tCreatures("howMany")}
          <input
            id="line-count"
            type="number"
            min={1}
            max={50}
            value={Number.isFinite(d.count) ? String(d.count) : ""}
            onChange={(e) => set({ count: e.target.valueAsNumber })}
            style={{ width: 96 }}
          />
        </label>
        {(mobbable || d.mob !== undefined) && (
          <label className="stack">
            {tCreatures("asMob")}
            <input
              id="line-mob"
              type="number"
              min={2}
              max={500}
              value={d.mob === undefined ? "" : String(d.mob)}
              onChange={handleMob}
              style={{ width: 96 }}
            />
          </label>
        )}
        <label className="stack">
          {t("form.visibility")}
          <select
            id="line-visibility"
            value={String(d.visibility)}
            onChange={(e) => set({ visibility: CombatVisibility.parse(e.target.value) })}
          >
            {CombatVisibility.options.map((v) => (
              <option key={v} value={v}>
                {tVisibility(v)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="row" style={{ minHeight: 44 }}>
        <input
          type="checkbox"
          checked={d.temporary === true}
          onChange={(e) => set({ temporary: e.target.checked })}
          style={{ minHeight: 24 }}
        />
        {tCreatures("temporary")}
      </label>
    </>
  );
}

// A test line: the Test, the inputs its call takes, who takes it, whether the target is hidden, and what each result
// means for the GM to read.
function TestFields({ d, set, state }: FieldsProps & { state: LineFormProps["state"] }) {
  const t = useTranslations("prep");
  const tCall = useTranslations("callForm");
  const def = state.testDefs.find((x) => x.id === d.testId);
  const inputs = (d.inputs ?? {}) as TestInputs;
  const actorIds = (d.actorIds ?? []) as string[];
  const outcomes = (d.outcomes ?? []) as { label: string; text: string }[];
  const roster = takers({ actors: state.actors, def });
  const words = testWords(def ?? { id: String(d.testId ?? "") });

  // One input of the call: a number, a ticked box, or text; an emptied one is left out.
  const handleInput = (id: string, type: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { [id]: _old, ...rest } = inputs;
    const raw = e.target.value;
    const v: string | number | boolean | undefined =
      type === "bool"
        ? (e.target as HTMLInputElement).checked
        : type === "int"
          ? raw.trim() === "" || !Number.isSafeInteger(Number(raw))
            ? undefined
            : Number(raw)
          : raw === ""
            ? undefined
            : raw;
    set({ inputs: v === undefined ? rest : { ...rest, [id]: v } });
  };

  // A mark of the Test (house decision #80): kept only while it is on.
  const handleMark = (id: string, on: boolean) => {
    const { [id]: _old, ...rest } = inputs;
    set({ inputs: on ? { ...rest, [id]: true } : rest });
  };

  // WHO: one character in or out of the listed takers.
  const handleWho = (id: string) =>
    set({ actorIds: actorIds.includes(id) ? actorIds.filter((x) => x !== id) : [...actorIds, id] });

  // One outcome's label or text.
  const handleOutcome =
    (i: number, field: "label" | "text") => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set({ outcomes: outcomes.map((o, j) => (j === i ? { ...o, [field]: e.target.value } : o)) });

  return (
    <>
      <label className="stack">
        {tCall("test")}
        <select
          id="line-test"
          value={String(d.testId ?? "")}
          onChange={(e) => set({ testId: e.target.value, inputs: {} })}
        >
          {!def && <option value={String(d.testId ?? "")}>{String(d.testId ?? "")}</option>}
          {state.testDefs.map((x) => (
            <option key={x.id} value={x.id}>
              {testWords(x).test}
            </option>
          ))}
        </select>
      </label>
      {def && (
        <MarkSwitches
          marks={def.marks ?? []}
          on={(id) => inputs[id] === true}
          onChange={handleMark}
          idPrefix="line-mark"
        />
      )}
      {def && def.inputs.length > 0 && (
        <div className="row" style={{ alignItems: "end" }}>
          {def.inputs.map((input) =>
            input.type === "bool" ? (
              <label key={input.id} className="row" style={{ minHeight: 44 }}>
                <input
                  type="checkbox"
                  checked={inputs[input.id] === true}
                  onChange={handleInput(input.id, "bool")}
                  style={{ minHeight: 24 }}
                />
                {words.input(input.id)}
              </label>
            ) : input.options ? (
              <label key={input.id} className="stack">
                {words.input(input.id)}
                <select
                  id={`line-input-${input.id}`}
                  value={String(inputs[input.id] ?? "")}
                  onChange={handleInput(input.id, input.type)}
                >
                  <option value="">{tCall("pick")}</option>
                  {input.options.map((o) => (
                    <option key={o} value={o}>
                      {words.value(input.id, o)}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label key={input.id} className="stack">
                {words.input(input.id)}
                <input
                  id={`line-input-${input.id}`}
                  inputMode={input.type === "int" ? "numeric" : "text"}
                  value={String(inputs[input.id] ?? "")}
                  onChange={handleInput(input.id, input.type)}
                  style={{ width: input.type === "int" ? 96 : 160 }}
                />
              </label>
            ),
          )}
        </div>
      )}
      <div className="stack">
        <span className="small">{tCall("whoRolls")}</span>
        <div className="row" role="group" aria-label={tCall("whoRolls")}>
          {TestTakers.options.map((k) => (
            <button
              key={k}
              type="button"
              className="btn sm"
              aria-pressed={d.takers === k}
              onClick={() => set({ takers: k })}
            >
              {t(`form.takers.${k}`)}
            </button>
          ))}
        </div>
        {d.takers === "listed" && (
          <div className="row" role="group" aria-label={t("form.takers.listed")}>
            {roster.map((a) => (
              <button
                key={a.id}
                type="button"
                className="btn sm"
                aria-pressed={actorIds.includes(a.id)}
                onClick={() => handleWho(a.id)}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {!def?.outcomes && (
        <label className="row" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={d.hideTarget === true}
            onChange={(e) => set({ hideTarget: e.target.checked })}
            style={{ minHeight: 24 }}
          />
          {tCall("hideTarget")}
        </label>
      )}
      <div className="stack">
        <span className="small">{t("form.outcomes")}</span>
        {outcomes.map((o, i) => (
          <div key={i} className="stack card" style={{ minWidth: 0 }}>
            <div className="row">
              <input
                aria-label={t("form.outcomeLabel")}
                placeholder={t("form.outcomeLabel")}
                value={o.label}
                onChange={handleOutcome(i, "label")}
                maxLength={40}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className="btn sm"
                aria-label={t("form.removeOutcome", { label: o.label })}
                onClick={() => set({ outcomes: outcomes.filter((_, j) => j !== i) })}
              >
                {t("remove")}
              </button>
            </div>
            <textarea
              aria-label={t("form.outcomeText")}
              placeholder={t("form.outcomeText")}
              rows={2}
              value={o.text}
              onChange={handleOutcome(i, "text")}
              maxLength={500}
            />
          </div>
        ))}
        {outcomes.length < MAX_OUTCOMES && (
          <button
            type="button"
            className="btn sm"
            style={{ justifySelf: "start" }}
            onClick={() => set({ outcomes: [...outcomes, { label: "", text: "" }] })}
          >
            {t("form.addOutcome")}
          </button>
        )}
      </div>
    </>
  );
}

// A reveal line: another entry of the room, shown to the party when the line is sent.
function RevealField({ d, set, entries, scene }: FieldsProps & { entries: readonly CodexEntry[]; scene: CodexEntry }) {
  const t = useTranslations("prep");
  const tCodex = useTranslations("codex");
  return (
    <label className="stack">
      {t("form.entry")}
      <select id="line-entry" value={String(d.entryId ?? "")} onChange={(e) => set({ entryId: e.target.value })}>
        <option value="">{t("form.pick")}</option>
        {entries
          .filter((e) => e.id !== scene.id)
          .map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} · {tCodex(`kind.${e.kind}`)}
            </option>
          ))}
      </select>
    </label>
  );
}

type PickFieldsProps = FieldsProps & { entries: readonly CodexEntry[]; scene: CodexEntry; ruleset: Ruleset | null };

// A pick line (house decision #89): an entry whose kind has a rows field a scene may pick from, that field, and which of
// its rows apply here, each toggled in or out (a row picked starts with its switch off).
function PickFields({ d, set, entries, scene, ruleset }: PickFieldsProps) {
  const t = useTranslations("prep");
  const tCodex = useTranslations("codex");
  const offered = entries.filter((e) => e.id !== scene.id && pickableFields({ ruleset, kind: e.kind }).length > 0);
  const entry = entries.find((e) => e.id === d.entryId);
  const fields = entry ? pickableFields({ ruleset, kind: entry.kind }) : [];
  const field = fields.find((f) => f.id === d.field);
  const picked = (d.rows ?? []) as { rowId: string; on: boolean }[];

  // The entry: its first pickable field is taken, and the rows picked of another entry go.
  const handleEntry = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = entries.find((x) => x.id === e.target.value);
    const first = next ? pickableFields({ ruleset, kind: next.kind })[0] : undefined;
    set({ entryId: e.target.value, field: first?.id ?? "", rows: [] });
  };

  // One row in or out of the line.
  const handleRow = (rowId: string) =>
    set({
      rows: picked.some((r) => r.rowId === rowId)
        ? picked.filter((r) => r.rowId !== rowId)
        : [...picked, { rowId, on: false }],
    });

  return (
    <>
      <label className="stack">
        {t("form.pickFrom")}
        <select id="line-pick-entry" value={String(d.entryId ?? "")} onChange={handleEntry}>
          <option value="">{t("form.pick")}</option>
          {offered.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} · {tCodex(`kind.${e.kind}`)}
            </option>
          ))}
        </select>
      </label>
      {fields.length > 1 && (
        <label className="stack">
          {t("form.pickField")}
          <select
            id="line-pick-field"
            value={String(d.field ?? "")}
            onChange={(e) => set({ field: e.target.value, rows: [] })}
          >
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.def.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {entry && field && (
        <div className="row" role="group" aria-label={t("form.pickRows", { field: field.def.label })}>
          {rowsOf(entry.fields[field.id]).map((row) => (
            <button
              key={row.id}
              type="button"
              className="btn sm"
              aria-pressed={picked.some((r) => r.rowId === row.id)}
              onClick={() => handleRow(row.id)}
            >
              {rowName({ def: field.def, row })}
            </button>
          ))}
          {rowsOf(entry.fields[field.id]).length === 0 && <span className="dim small">{t("form.noRows")}</span>}
        </div>
      )}
    </>
  );
}
