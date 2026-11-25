"use client";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import type { LiveState } from "@inconsistable/core-schema";

import { CallCard } from "@/components/gm/tests/components/call-card/call-card";
import type { Send } from "@/hooks/use-table/use-table";
import { callBand } from "@/lib/call-band/call-band";

type CallBandProps = { state: LiveState; send: Send; onMore: () => void };

// Under the tabs on every GM tab: the open calls (two at most) and a link to TESTS for the rest. Nothing when none is open.
export function CallBand({ state, send, onMore }: CallBandProps) {
  const t = useTranslations("gmApp.header");
  const names = useMemo(() => new Map(state.actors.map((a) => [a.id, a.name])), [state.actors]);
  const { shown, more } = callBand({ tests: state.tests });
  if (shown.length === 0) return null;
  return (
    <section className="stack call-band" aria-label={t("openCalls")}>
      <div className="grid">
        {shown.map((c) => (
          <CallCard key={c.id} call={c} def={state.testDefs.find((d) => d.id === c.testId)} names={names} send={send} />
        ))}
      </div>
      {more > 0 && (
        <button className="btn" onClick={onMore}>
          {t("moreCalls", { count: more })}
        </button>
      )}
    </section>
  );
}
