"use client";
import { useTranslations } from "next-intl";

import type { BuildStep, LedgerRow } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import { ledgerGroups } from "@/lib/ledger/ledger";

import { useLedger } from "../../ledger-context";

type LedgerPanelProps = { onGo: (step: BuildStep) => void };

// The ledger behind the XP bar: what creation bought, step by step, and what play bought, session by session, each
// row with its cite; then what is still to settle (a tap goes to its step), what the sheet has no field for, and the
// sheet the build resolves to.
export function LedgerPanel({ onGo }: LedgerPanelProps) {
  const t = useTranslations("ledgerBuilder.ledger");
  const steps = useTranslations("ledgerBuilder.steps");
  const { params, resolved } = useLedger();
  if (!resolved) return null;
  const { creation, sessions } = ledgerGroups(resolved.ledger);
  const todo = [
    ...resolved.pending.map((p) => ({ step: p.step, what: p.what, cite: p.cite, kind: "todo" as const })),
    ...resolved.problems.map((p) => ({ step: p.step, what: p.what, cite: p.cite, kind: p.severity })),
  ];
  const sheet = resolved.sheet;
  const skills = Object.entries(sheet.skills).filter(([, v]) => (v ?? 0) > 0);

  return (
    <div className="stack lb-ledger">
      <section className="stack" aria-labelledby="lb-l-creation">
        <h3 id="lb-l-creation" className="lb-sub">
          {t("creation", { spent: resolved.spent, budget: resolved.budget })}
        </h3>
        {creation.length === 0 && <p className="dim">{t("nothing")}</p>}
        {creation.map((g) => (
          <Rows key={g.step} title={t("group", { step: steps(g.step), xp: g.xp })} rows={g.rows} />
        ))}
      </section>

      {resolved.advancement && (
        <section className="stack" aria-labelledby="lb-l-play">
          <h3 id="lb-l-play" className="lb-sub">
            {t("play", {
              rank: resolved.advancement.rank,
              spent: resolved.advancement.spent,
              budget: resolved.advancement.budget,
            })}
          </h3>
          {sessions.length === 0 && <p className="dim">{t("nothing")}</p>}
          {sessions.map((g) => (
            <Rows
              key={g.session ?? "none"}
              title={g.session === null ? t("unrecorded", { xp: g.xp }) : t("session", { n: g.session, xp: g.xp })}
              rows={g.rows}
            />
          ))}
        </section>
      )}

      <section className="stack" aria-labelledby="lb-l-todo">
        <h3 id="lb-l-todo" className="lb-sub">
          {t("todo")}
        </h3>
        {todo.length === 0 ? (
          <p>{t("allDone")}</p>
        ) : (
          <ul className="list lb-plain">
            {todo.map((x, i) => (
              <li key={i}>
                <button type="button" className="found lb-row" data-kind={x.kind} onClick={() => onGo(x.step)}>
                  <span className="lb-row-text">
                    <span>
                      <span className="lb-tag">{t(`kind.${x.kind}`)}</span> {x.what}
                    </span>
                    <span className="small dim">{[steps(x.step), x.cite].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="small lb-row-state">{t("goTo")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {resolved.effects.length > 0 && (
        <section className="stack" aria-labelledby="lb-l-effects">
          <h3 id="lb-l-effects" className="lb-sub">
            {t("effects")}
          </h3>
          <ul className="lb-plain-list">
            {resolved.effects.map((e, i) => (
              <li key={i}>
                {e.what}
                {e.cite && (
                  <span className="small dim">
                    {" "}
                    · <Cite cite={e.cite} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack" aria-labelledby="lb-l-sheet">
        <h3 id="lb-l-sheet" className="lb-sub">
          {t("sheet")}
        </h3>
        <p>{[sheet.archetype, sheet.species].filter(Boolean).join(" · ")}</p>
        {sheet.keywords.length > 0 && <p className="small">{sheet.keywords.join(", ")}</p>}
        <dl className="derived-list lb-sheet">
          {params.vocabulary.attributes.map((a) => (
            <div key={a.id}>
              <dt>{a.name}</dt>
              <dd>{sheet.attributes[a.id]}</dd>
            </div>
          ))}
        </dl>
        {skills.length > 0 && <p className="small">{skills.map(([k, v]) => `${k} ${v}`).join(" · ")}</p>}
        <SheetLine title={t("talents")} items={sheet.talents.map((x) => x.name)} />
        <SheetLine title={t("abilities")} items={sheet.abilities.map((x) => x.name)} />
        <SheetLine
          title={t("gear")}
          items={[
            ...sheet.weapons.map((w) => w.name),
            ...(sheet.armour.name ? [sheet.armour.name] : []),
            ...sheet.gear,
          ]}
        />
        <p className="small">{t("wealth", { wealth: sheet.wealth, corruption: sheet.corruption })}</p>
      </section>
    </div>
  );
}

type RowsProps = { title: string; rows: LedgerRow[] };

// One group of ledger rows: what was bought, its price, and where it is printed.
function Rows({ title, rows }: RowsProps) {
  return (
    <div className="stack lb-group">
      <h4 className="pick-name">{title}</h4>
      <ul className="lb-ledger-rows">
        {rows.map((r, i) => (
          <li key={i}>
            <span className="lb-row-text">
              <span>{r.what}</span>
              {r.cite && <Cite cite={r.cite} />}
            </span>
            <span className="lb-xp">{r.xp}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type SheetLineProps = { title: string; items: string[] };

function SheetLine({ title, items }: SheetLineProps) {
  if (items.length === 0) return null;
  return (
    <p className="small">
      <strong>{title}:</strong> {items.join(", ")}
    </p>
  );
}
