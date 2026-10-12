"use client";
import { useMemo } from "react";

import type { LiveState } from "@inconsistable/core-schema";

import { CallCard } from "@/components/gm/tests/components/call-card/call-card";
import { CallForm } from "@/components/gm/tests/components/call-form/call-form";
import type { Send } from "@/hooks/use-table/use-table";

type TestsProps = { state: LiveState; send: Send };

// TESTS: the GM calls a Test of the ruleset on some characters, watches the rolls come in and closes it. The dice stay
// on the table; this tablet only records what the players read off them (docs/design.md §6.3).
export function Tests({ state, send }: TestsProps) {
  const names = useMemo(() => new Map(state.actors.map((a) => [a.id, a.name])), [state.actors]);
  const open = state.tests.filter((c) => c.status === "open");
  const closed = state.tests.filter((c) => c.status === "closed");
  return (
    <div className="stack" style={{ gap: 24 }}>
      <CallForm key={state.testDefs.map((d) => d.id).join()} state={state} send={send} />
      <section className="stack">
        <h2 className="head">Open</h2>
        {open.length === 0 && <p className="dim">No Test is open. Call one above.</p>}
        <div className="grid">
          {open.map((c) => (
            <CallCard key={c.id} call={c} names={names} send={send} />
          ))}
        </div>
      </section>
      {closed.length > 0 && (
        <section className="stack">
          <h2 className="head">Closed this session</h2>
          <div className="grid">
            {closed.map((c) => (
              <CallCard key={c.id} call={c} names={names} send={send} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
