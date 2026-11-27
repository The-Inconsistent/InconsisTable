"use client";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ChangeEvent, type CSSProperties } from "react";

import { HandoutLayout } from "@inconsistable/core-schema";
import {
  WORLD_SHAPES,
  WORLD_TEXTURES,
  WORLD_TYPEFACES,
  WORLD_TYPE_ROLES,
  WorldTheme,
  type WorldShape,
  type WorldTypeRole,
} from "@inconsistable/rules-engine";

import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import { HandoutDoc } from "@/components/ui/handout-doc/handout-doc";
import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import { SAMPLE_WORLDS, type SampleWorld } from "@/lib/world/sample";
import { worldLook, worldStyle } from "@/lib/world/world";

import { DENSITIES, SET_CHOICES, type Density, type SetChoice } from "./constants";

// What the controls change on top of the chosen sample: a pick per list, by its key ("" puts a typeface back to base).
type Overrides = { texture?: string; shapes: Partial<Record<WorldShape, string>>; typefaces: Record<string, string> };
const NONE: Overrides = { shapes: {}, typefaces: {} };

// The development page: a stand-in table inside a World wrapper, with a control for each list and each colour set. The
// World lives in this state only; the device's own colour pick is the switch in the band, as in a room.
export function WorldDev() {
  const t = useTranslations("world.dev");
  const tHandout = useTranslations("handout");
  const [name, setName] = useState<SampleWorld>("hoarfrost");
  const [sets, setSets] = useState<SetChoice>("both");
  const [density, setDensity] = useState<Density>("table");
  const [overrides, setOverrides] = useState<Overrides>(NONE);
  const [sheetOpen, setSheetOpen] = useState(false);

  const sample = SAMPLE_WORLDS[name];
  const look = useMemo(() => {
    const typefaces = { ...sample.typefaces, ...overrides.typefaces };
    const theme = WorldTheme.parse({
      ...sample,
      schemes: sets === "both" ? sample.schemes : { [sets]: sample.schemes[sets] ?? {} },
      texture: overrides.texture ?? sample.texture,
      shapes: { ...sample.shapes, ...overrides.shapes },
      typefaces: Object.fromEntries(Object.entries(typefaces).filter(([, face]) => face)),
    });
    return worldLook(theme);
  }, [sample, sets, overrides]);

  // WORLD: another sample, with every control back to what it picks.
  const handleWorld = (e: ChangeEvent<HTMLSelectElement>) => {
    setName(e.target.value as SampleWorld);
    setOverrides(NONE);
  };
  // A shape list's select: that one pick over the sample's.
  const handleShape = (shape: WorldShape) => (e: ChangeEvent<HTMLSelectElement>) =>
    setOverrides({ ...overrides, shapes: { ...overrides.shapes, [shape]: e.target.value } });
  // A typeface role's select: that face, or the base face for "".
  const handleFace = (role: WorldTypeRole) => (e: ChangeEvent<HTMLSelectElement>) =>
    setOverrides({ ...overrides, typefaces: { ...overrides.typefaces, [role]: e.target.value } });

  return (
    <div {...look.attributes}>
      <style>{worldStyle(look)}</style>
      <div className="surface-table" data-density={density === "tv" ? "tv" : undefined}>
        <header className="band">
          <strong>{t("title")}</strong>
          <span className="row">
            <LocaleSwitch />
            <ThemeSwitch />
          </span>
        </header>
        <nav className="tabs" role="tablist" aria-label={t("tabs")}>
          <button type="button" className="tab" role="tab" aria-selected="true">
            {t("tab.fight")}
          </button>
          <button type="button" className="tab" role="tab" aria-selected="false">
            {t("tab.sheet")}
          </button>
          <button type="button" className="tab" role="tab" aria-selected="false">
            {t("tab.notes")}
          </button>
        </nav>
        <main className="page">
          <section className="card stack" aria-label={t("controls")}>
            <p className="dim">{t("lede")}</p>
            <div className="row">
              <label>
                {t("world")}
                <select value={name} onChange={handleWorld}>
                  {Object.keys(SAMPLE_WORLDS).map((w) => (
                    <option key={w} value={w}>
                      {t(`worlds.${w as SampleWorld}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("sets")}
                <select value={sets} onChange={(e) => setSets(e.target.value as SetChoice)}>
                  {SET_CHOICES.map((s) => (
                    <option key={s} value={s}>
                      {t(`set.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("density")}
                <select value={density} onChange={(e) => setDensity(e.target.value as Density)}>
                  {DENSITIES.map((d) => (
                    <option key={d} value={d}>
                      {t(`densityName.${d}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row">
              <label>
                texture
                <select
                  value={look.attributes["data-texture"]}
                  onChange={(e) => setOverrides({ ...overrides, texture: e.target.value })}
                >
                  {WORLD_TEXTURES.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              {(Object.keys(WORLD_SHAPES) as WorldShape[]).map((shape) => (
                <label key={shape}>
                  {shape}
                  <select
                    value={overrides.shapes[shape] ?? sample.shapes[shape] ?? WORLD_SHAPES[shape][0]}
                    onChange={handleShape(shape)}
                  >
                    {WORLD_SHAPES[shape].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              ))}
              {WORLD_TYPE_ROLES.map((role) => (
                <label key={role}>
                  {role}
                  <select value={overrides.typefaces[role] ?? sample.typefaces[role] ?? ""} onChange={handleFace(role)}>
                    <option value="">{t("baseFace")}</option>
                    {WORLD_TYPEFACES.map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <div className="fightbar">
            <span className="round">{t("round", { round: 3 })}</span>
            <button type="button" className="btn">
              {t("nextTurn")}
            </button>
            <button type="button" className="btn primary">
              {t("endFight")}
            </button>
          </div>
          <p className="turn-banner">
            <span className="turn-icon" aria-hidden="true" />
            {t("yourTurn")}
          </p>

          <div className="phone-strip">
            <span className="phone-strip-name">{t("names.first")}</span>
          </div>
          <div className="fight-plate" data-mine="true">
            <span className="fight-plate-kicker">{t("nowActing")}</span>
            <span className="fight-plate-name">{t("names.first")}</span>
          </div>

          <ol className="order" aria-label={t("order")}>
            <li className="combatant" data-side="ally">
              <span className="who">
                <span className="name">{t("names.third")}</span>
                <span className="row small dim">
                  <span className="chip">{t("party")}</span>
                </span>
              </span>
              <span className="score">11</span>
            </li>
            <li className="combatant" data-acting="true" data-side="ally">
              <span className="who">
                <span className="name">{t("names.first")}</span>
                <span className="row small dim">
                  <span className="chip" data-first="true">
                    {t("firstPlayer")}
                  </span>
                  <span className="chip">{t("party")}</span>
                  <span className="state-word" data-state="acting">
                    {t("acting")}
                  </span>
                </span>
                <span className="bar" role="img" aria-label={t("health", { now: 18, max: 24 })}>
                  <span style={{ transform: "scaleX(0.75)" }} />
                </span>
              </span>
              <span className="score">14</span>
            </li>
            <li className="combatant" data-side="foe">
              <span className="who">
                <span className="name">{t("names.second")}</span>
                <span className="row small dim">
                  <span className="chip">{t("foe")}</span>
                  <span className="state-word" data-state="down">
                    {t("bloodied")}
                  </span>
                </span>
                <span className="bar" data-low="true" role="img" aria-label={t("health", { now: 3, max: 20 })}>
                  <span style={{ transform: "scaleX(0.15)" }} />
                </span>
              </span>
              <span className="score">9</span>
            </li>
          </ol>

          <div className="grid">
            <article className="card">
              <h3 className="card-name">{t("names.first")}</h3>
              <p>{t("cardText")}</p>
              <div className="row">
                <span className="chip">{t("chip.ready")}</span>
                <span className="chip">{t("chip.hidden")}</span>
                <button type="button" className="chip" aria-pressed="true">
                  {t("chip.pressed")}
                </button>
              </div>
              <div className="row">
                <button type="button" className="btn">
                  {t("button.plain")}
                </button>
                <button type="button" className="btn primary">
                  {t("button.main")}
                </button>
              </div>
            </article>
            <article className="card">
              <h3 className="card-name">{t("names.second")}</h3>
              <label>
                {t("field")}
                <input defaultValue={t("fieldValue")} />
              </label>
              <p className="problem-path">{t("machine")}</p>
            </article>
          </div>

          <section className="sheet stack">
            <div className="sheet-card stack">
              <h2 className="head">{t("section.abilities")}</h2>
              <div className="sheet-rows">
                <div className="sheet-row" data-stat="hp">
                  <span className="stat-label">{t("stat.health")}</span>
                  <span className="sheet-num">18</span>
                </div>
                <div className="sheet-row" data-stat="defence">
                  <span className="stat-label">{t("stat.defence")}</span>
                  <span className="sheet-num">14</span>
                </div>
                <div className="sheet-row">
                  <span className="stat-label">{t("stat.speed")}</span>
                  <span className="sheet-num">30</span>
                </div>
              </div>
            </div>
            <div className="sheet-card stack">
              <h2 className="head">{t("section.notes")}</h2>
              <p>{t("notes")}</p>
            </div>
            <div className="sheet-card stack">
              <h2 className="head">{t("section.grid")}</h2>
              <div
                role="table"
                className="w-grid"
                aria-label={t("section.grid")}
                style={{ "--cols": 2 } as CSSProperties}
              >
                <div role="row" className="w-grid-row w-grid-head">
                  <span role="columnheader" />
                  <span role="columnheader">{t("stat.speed")}</span>
                  <span role="columnheader">{t("stat.defence")}</span>
                </div>
                <div role="row" className="w-grid-row">
                  <span role="rowheader">{t("grid.rating")}</span>
                  <span role="cell">3</span>
                  <span role="cell">4</span>
                </div>
              </div>
            </div>
          </section>

          <label className="stack sealed">
            {t("gmOnly")}
            <textarea rows={2} defaultValue={t("gmOnlyText")} />
          </label>

          <section className="stack" aria-label={t("buttons")}>
            <h2 className="head">{t("buttons")}</h2>
            <div className="row">
              <button type="button" className="btn">
                {t("button.plain")}
              </button>
              <button type="button" className="btn primary">
                {t("button.main")}
              </button>
              <button type="button" className="btn sm">
                {t("button.small")}
              </button>
              <button type="button" className="btn" aria-pressed="true">
                {t("button.pressed")}
              </button>
              <button type="button" className="btn" disabled>
                {t("button.disabled")}
              </button>
              <button type="button" className="btn step" aria-label={t("button.step")}>
                +
              </button>
              <button type="button" className="btn" onClick={() => setSheetOpen(true)}>
                {t("button.sheet")}
              </button>
            </div>
            <p className="problem-path">{t("machine")}</p>
          </section>

          <section className="stack" aria-label={t("handouts")}>
            <h2 className="head">{t("handouts")}</h2>
            {HandoutLayout.options.map((layout) => (
              <article key={layout} className="card stack">
                <h3 className="card-name">{tHandout(`layout.${layout}`)}</h3>
                <HandoutDoc
                  layout={layout}
                  header={t("handoutHeader")}
                  title={t("handoutTitle")}
                  body={t("handoutBody")}
                  entries={[]}
                />
              </article>
            ))}
          </section>
        </main>
        {sheetOpen && (
          <BottomSheet title={t("sheetTitle")} onClose={() => setSheetOpen(false)}>
            <p>{t("sheetText")}</p>
          </BottomSheet>
        )}
      </div>
    </div>
  );
}
