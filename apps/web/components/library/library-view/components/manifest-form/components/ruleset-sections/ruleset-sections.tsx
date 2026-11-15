"use client";
import { useTranslations } from "next-intl";

import { getAt, setAt, type Path } from "@/lib/manifest-form/manifest-form";
import type { RulesetSection } from "@/lib/manifest-form/manifest-form";

import {
  BAND_SPECS,
  CONDITION_SPECS,
  CREATION_KINDS,
  DECISION_SPECS,
  DEGREES_SPECS,
  EFFECT_SPECS,
  END_SPECS,
  ENTITY_SPECS,
  FIELD_BASE_KEYS,
  FIELD_BASE_SPECS,
  FIELD_EXTRA,
  FIELD_TYPES,
  GAME_MODES,
  GAME_SPECS,
  INITIATIVE_STRATEGIES,
  OPTION_SPECS,
  OUTCOME_SPECS,
  PHASE_SPECS,
  POOL_SPECS,
  RANKED_SPECS,
  REPORTED_SPECS,
  RESOURCE_SPECS,
  SCORING_SPECS,
  SEATED_SPECS,
  SOURCE_SPECS,
  STEP_EXTRA,
  STEP_SPECS,
  SUM_SPECS,
  TEST_KINDS,
  type TestKind,
} from "../../constants";
import { useForm } from "../../form-context";
import { Block, Field, Fields, KeyedRows, Pick, RawField, Rows, Toggle } from "../form-fields/form-fields";

const ROOT: Path = [];

// The keys of an object that survive a change of its kind (the shared ones), so switching a Test or a field to another
// kind does not lose what the user typed for every kind.
const keep = ({ obj, keys }: { obj: unknown; keys: readonly string[] }): Record<string, unknown> =>
  Object.fromEntries(
    keys.flatMap((k) => {
      const v = getAt(obj, [k]);
      return v === undefined ? [] : [[k, v]];
    }),
  );

const isOne = <T extends string>(list: readonly T[], v: unknown): v is T => list.some((x) => x === v);

function About() {
  const t = useTranslations("manifestForm");
  return (
    <>
      <Fields
        path={ROOT}
        specs={[
          { key: "id", kind: "text" },
          { key: "version", kind: "text" },
          { key: "core", kind: "text" },
        ]}
      />
      <Block title={t("blocks.sources")}>
        <Rows path={["sources"]} make={() => ({ id: "", title: "", license: "homebrew" })}>
          {(p) => <Fields path={p} specs={SOURCE_SPECS} />}
        </Rows>
      </Block>
    </>
  );
}

// The modes a table may sit in: a checkbox each, kept in the engine's order.
function Modes() {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const value = getAt(form.doc, ["game", "modes"]);
  const modes = Array.isArray(value) ? value : [];
  const handleToggle = (mode: string, on: boolean) =>
    form.set(
      ["game", "modes"],
      GAME_MODES.filter((m) => (m === mode ? on : modes.includes(m))),
    );
  return (
    <fieldset className="mf-modes">
      <legend>{t("f.modes")}</legend>
      {GAME_MODES.map((m) => (
        <label key={m} className="mf-check">
          <input type="checkbox" checked={modes.includes(m)} onChange={(e) => handleToggle(m, e.target.checked)} />
          {m}
        </label>
      ))}
    </fieldset>
  );
}

function Game() {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const on = getAt(form.doc, ["game"]) !== undefined;
  return (
    <>
      <Toggle path={["game"]} make={() => ({ title: "", players: {}, modes: ["gm"] })} label={t("gameToggle")} />
      {on && (
        <>
          <Fields path={["game"]} specs={GAME_SPECS} />
          <div className="mf-grid">
            <Field path={["game", "players"]} spec={{ key: "min", kind: "int" }} />
            <Field path={["game", "players"]} spec={{ key: "max", kind: "int" }} />
          </div>
          <Modes />
        </>
      )}
    </>
  );
}

function EntityFields({ path }: { path: Path }) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  return (
    <Block title={t("blocks.fields")}>
      <KeyedRows path={[...path, "fields"]} newKey="field" make={() => ({ type: "text", label: "" })}>
        {(p) => {
          const type = getAt(form.doc, [...p, "type"]);
          const extra = isOne(FIELD_TYPES, type) ? FIELD_EXTRA[type] : [];
          // Another type: the shared keys stay, the ones that belonged to the old type go.
          const handlePick = (next: string) =>
            form.edit((doc) =>
              setAt({ doc, path: p, value: { ...keep({ obj: getAt(doc, p), keys: FIELD_BASE_KEYS }), type: next } }),
            );
          return (
            <Fields
              path={p}
              specs={[...FIELD_BASE_SPECS, ...extra]}
              lead={
                <Pick
                  label={t("f.type")}
                  value={typeof type === "string" ? type : ""}
                  options={FIELD_TYPES}
                  onPick={handlePick}
                />
              }
            />
          );
        }}
      </KeyedRows>
    </Block>
  );
}

function Entities() {
  return (
    <Rows path={["entities"]} make={() => ({ id: "", label: "", base: "actor", fields: {} })} hide={[".fields"]}>
      {(p) => (
        <>
          <Fields path={p} specs={ENTITY_SPECS} />
          <EntityFields path={p} />
          <RawField path={p} field="derived" />
        </>
      )}
    </Rows>
  );
}

function Resources() {
  return (
    <Rows path={["resources"]} make={() => ({ id: "", label: "", scope: "entity" })}>
      {(p) => (
        <>
          <Fields path={p} specs={RESOURCE_SPECS} />
          <RawField path={p} field="resetOn" />
        </>
      )}
    </Rows>
  );
}

function Conditions() {
  const t = useTranslations("manifestForm");
  return (
    <Rows path={["conditions"]} make={() => ({ id: "", label: "", duration: "manual" })} hide={[".effects"]}>
      {(p) => (
        <>
          <Fields path={p} specs={CONDITION_SPECS} />
          <Block title={t("blocks.effects")}>
            <Rows path={[...p, "effects"]} make={() => ({ path: "", mode: "add", value: "" })}>
              {(ep) => <Fields path={ep} specs={EFFECT_SPECS} />}
            </Rows>
          </Block>
        </>
      )}
    </Rows>
  );
}

// What a Test of each kind starts as: only the kind's own required keys, empty, so the validator lists what to fill.
const TEST_SKELETON: Record<TestKind, () => Record<string, unknown>> = {
  sumVsTarget: () => ({ dice: "", target: "" }),
  poolSuccesses: () => ({ pool: "", target: "", bands: [] }),
  reported: () => ({
    outcomes: [
      { id: "", label: "" },
      { id: "", label: "" },
    ],
  }),
};

function TestBody({ path }: { path: Path }) {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const kind = getAt(form.doc, [...path, "kind"]);
  const handlePick = (next: string) => {
    if (!isOne(TEST_KINDS, next)) return;
    form.edit((doc) =>
      setAt({
        doc,
        path,
        value: { kind: next, ...TEST_SKELETON[next](), ...keep({ obj: getAt(doc, path), keys: ["cite"] }) },
      }),
    );
  };
  const pick = (
    <Pick label={t("f.kind")} value={typeof kind === "string" ? kind : ""} options={TEST_KINDS} onPick={handlePick} />
  );
  const raws = (
    <>
      <RawField path={path} field="inputs" />
      <RawField path={path} field="inputOptions" />
    </>
  );
  if (kind === "sumVsTarget") {
    const hasDegrees = getAt(form.doc, [...path, "degrees"]) !== undefined;
    return (
      <>
        <Fields path={path} specs={SUM_SPECS} lead={pick} />
        <Toggle path={[...path, "degrees"]} make={() => ({})} label={t("degreesToggle")} />
        {hasDegrees && <Fields path={[...path, "degrees"]} specs={DEGREES_SPECS} />}
        {raws}
      </>
    );
  }
  if (kind === "poolSuccesses") {
    return (
      <>
        <Fields path={path} specs={POOL_SPECS} lead={pick} />
        <Block title={t("blocks.bands")}>
          <Rows path={[...path, "bands"]} make={() => ({ id: "" })}>
            {(bp) => <Fields path={bp} specs={BAND_SPECS} />}
          </Rows>
        </Block>
        <RawField path={path} field="special" />
        {raws}
      </>
    );
  }
  if (kind === "reported") {
    return (
      <>
        <Fields path={path} specs={REPORTED_SPECS} lead={pick} />
        <Block title={t("blocks.outcomes")}>
          <Rows path={[...path, "outcomes"]} make={() => ({ id: "", label: "" })}>
            {(op) => <Fields path={op} specs={OUTCOME_SPECS} />}
          </Rows>
        </Block>
        <RawField path={path} field="inputs" />
      </>
    );
  }
  return <div className="mf-grid">{pick}</div>;
}

function Tests() {
  return (
    <KeyedRows
      path={["tests"]}
      newKey="test"
      make={() => ({ kind: "reported", ...TEST_SKELETON.reported() })}
      hide={[".bands", ".outcomes", ".degrees"]}
    >
      {(p) => <TestBody path={p} />}
    </KeyedRows>
  );
}

function Turn() {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const strategy = getAt(form.doc, ["initiative", "strategy"]);
  const handlePick = (next: string) => {
    if (next === "") return form.remove(["initiative"]);
    form.edit((doc) =>
      setAt({
        doc,
        path: ["initiative"],
        value: {
          strategy: next,
          ...(next === "ranked" ? { score: "" } : { firstPlayer: "fixed" }),
          ...keep({ obj: getAt(doc, ["initiative"]), keys: ["cite"] }),
        },
      }),
    );
  };
  return (
    <>
      <div className="mf-grid">
        <Pick
          label={t("f.strategy")}
          value={typeof strategy === "string" ? strategy : "none"}
          options={["none", ...INITIATIVE_STRATEGIES]}
          onPick={(v) => handlePick(v === "none" ? "" : v)}
        />
      </div>
      {strategy === "ranked" && (
        <>
          <Fields path={["initiative"]} specs={RANKED_SPECS} />
          <RawField path={["initiative"]} field="tiebreak" />
        </>
      )}
      {strategy === "seated" && <Fields path={["initiative"]} specs={SEATED_SPECS} />}
    </>
  );
}

const STEP_SKELETON = {
  choose: () => ({ pick: "" }),
  assign: () => ({ fields: [], method: { kind: "table", values: [] } }),
  fields: () => ({ fields: [] }),
};

function Creation() {
  const t = useTranslations("manifestForm");
  const form = useForm();
  return (
    <Rows path={["creation"]} make={() => ({ kind: "fields", id: "", actor: "", label: "", fields: [] })}>
      {(p) => {
        const kind = getAt(form.doc, [...p, "kind"]);
        const known = isOne(CREATION_KINDS, kind);
        const handlePick = (next: string) => {
          if (!isOne(CREATION_KINDS, next)) return;
          form.edit((doc) =>
            setAt({
              doc,
              path: p,
              value: {
                kind: next,
                ...STEP_SKELETON[next](),
                ...keep({ obj: getAt(doc, p), keys: STEP_SPECS.map((s) => s.key) }),
              },
            }),
          );
        };
        return (
          <>
            <Fields
              path={p}
              specs={[...STEP_SPECS, ...(known ? STEP_EXTRA[kind] : [])]}
              lead={
                <Pick
                  label={t("f.kind")}
                  value={typeof kind === "string" ? kind : ""}
                  options={CREATION_KINDS}
                  onPick={handlePick}
                />
              }
            />
            {kind === "choose" && <RawField path={p} field="copy" />}
            {kind === "assign" && <RawField path={p} field="method" />}
          </>
        );
      }}
    </Rows>
  );
}

function Board() {
  const t = useTranslations("manifestForm");
  const form = useForm();
  const scoring = getAt(form.doc, ["scoring"]) !== undefined;
  return (
    <>
      <Block title={t("blocks.phases")}>
        <Rows path={["phases"]} make={() => ({ id: "", label: "", mode: "turns" })}>
          {(p) => <Fields path={p} specs={PHASE_SPECS} />}
        </Rows>
      </Block>
      <Block title={t("blocks.scoring")}>
        <Toggle path={["scoring"]} make={() => ({ score: "" })} label={t("scoringToggle")} />
        {scoring && (
          <>
            <Fields path={["scoring"]} specs={SCORING_SPECS} />
            <RawField path={["scoring"]} field="tiebreaks" />
            <Rows path={["scoring", "endWhen"]} make={() => ({ when: "" })}>
              {(p) => <Fields path={p} specs={END_SPECS} />}
            </Rows>
          </>
        )}
      </Block>
    </>
  );
}

function More() {
  const t = useTranslations("manifestForm");
  return (
    <>
      <Block title={t("blocks.options")}>
        <Rows path={["options"]} make={() => ({ id: "", label: "" })}>
          {(p) => <Fields path={p} specs={OPTION_SPECS} />}
        </Rows>
      </Block>
      <Block title={t("blocks.decisions")}>
        <Rows path={["decisions"]} make={() => ({ id: "", text: "" })}>
          {(p) => <Fields path={p} specs={DECISION_SPECS} />}
        </Rows>
      </Block>
      <Block title={t("blocks.raw")}>
        <RawField path={ROOT} field="health" />
        <RawField path={ROOT} field="terms" />
        <RawField path={ROOT} field="layout" />
        <RawField path={ROOT} field="extends" />
      </Block>
    </>
  );
}

const BODIES: Partial<Record<RulesetSection, () => React.JSX.Element>> = {
  about: About,
  game: Game,
  fields: Entities,
  resources: Resources,
  conditions: Conditions,
  tests: Tests,
  turn: Turn,
  creation: Creation,
  board: Board,
  more: More,
};

/** The body of one section of the ruleset form (everything but the JSON tab, which the shell owns). */
export function RulesetBody({ section }: { section: RulesetSection }) {
  const Body = BODIES[section];
  return Body ? <Body /> : null;
}
