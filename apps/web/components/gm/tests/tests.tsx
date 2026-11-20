"use client";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import type { LiveState } from "@inconsistable/core-schema";

import { CallCard } from "@/components/gm/tests/components/call-card/call-card";
import { CallForm } from "@/components/gm/tests/components/call-form/call-form";
import type { Send } from "@/hooks/use-table/use-table";

type TestsProps = { state: LiveState; send: Send; /** A Test to preselect (PREP's Call button). */ testId?: string };

// TESTS: the GM calls a Test of the ruleset on some characters, watches the rolls come in and closes it. The dice stay
// on the table; this tablet only records what the players read off them (docs/design.md §6.3).
export function Tests({ state, send, testId }: TestsProps) {
  const t = useTranslations("tests");
  const names = useMemo(() => new Map(state.actors.map((a) => [a.id, a.name])), [state.actors]);
  const defs = useMemo(() => new Map(state.testDefs.map((d) => [d.id, d])), [state.testDefs]);
  const open = state.tests.filter((c) => c.status === "open");
  const closed = state.tests.filter((c) => c.status === "closed");
  return (
    <div className="stack" style={{ gap: 24 }}>
      <CallForm
        key={`${testId ?? ""}${state.testDefs.map((d) => d.id).join()}`}
        state={state}
        send={send}
        initialTestId={testId}
      />
      <section className="stack">
        <h2 className="head">{t("open")}</h2>
        {open.length === 0 && <p className="dim">{t("noneOpen")}</p>}
        <div className="grid">
          {open.map((c) => (
            <CallCard key={c.id} call={c} def={defs.get(c.testId)} names={names} send={send} />
          ))}
        </div>
      </section>
      {closed.length > 0 && (
        <section className="stack">
          <h2 className="head">{t("closedThisSession")}</h2>
          <div className="grid">
            {closed.map((c) => (
              <CallCard key={c.id} call={c} def={defs.get(c.testId)} names={names} send={send} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
