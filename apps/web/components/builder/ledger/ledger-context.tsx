"use client";
import { createContext, useContext, type ReactNode } from "react";

import type {
  BuildCatalogue,
  BuildCtx,
  BuildParams,
  BuildStep,
  LedgerRequirement,
  ResolvedBuild,
} from "@inconsistable/rules-engine";

import {
  reachOf,
  recordCite,
  type LedgerBuild,
  type LedgerPlay,
  type Lookups,
  type StepIssues,
} from "@/lib/ledger/ledger";

import type { RecordRow } from "./components/record-list/record-list";

// What every step of the ledger builder reads: the inputs, the build resolved on the device, and the two ways out
// (the next build document, and another step).
export type LedgerState = {
  params: BuildParams;
  catalogue: BuildCatalogue;
  lookups: Lookups;
  build: LedgerBuild;
  resolved: ResolvedBuild | null;
  issues: Record<BuildStep, StepIssues>;
  ctx: BuildCtx | null;
  gm: boolean;
  tier: number | undefined; // given from outside: the Tier step only shows it
  play: LedgerPlay | undefined;
  edit: (next: LedgerBuild) => void;
  go: (step: BuildStep) => void;
};

const LedgerContext = createContext<LedgerState | null>(null);
export const LedgerProvider = LedgerContext.Provider;

export function useLedger(): LedgerState {
  const state = useContext(LedgerContext);
  if (!state) throw new Error("useLedger is used outside LedgerBuilder");
  return state;
}

type RowInput = {
  record: { id: string; name: string; source: string; page: number; summary?: string | undefined };
  requires?: readonly LedgerRequirement[] | undefined;
  taken: boolean;
  extra?: ReactNode[]; // numbers shown after the cite: a price, a Tier, a category
  blocked?: string | undefined;
};
// Turns a catalogue record into a list row: its cite and numbers, and what the engine says about its requirements.
export function useRowOf() {
  const { params, resolved, ctx } = useLedger();
  return ({ record, requires, taken, extra = [], blocked }: RowInput): RecordRow => {
    const cite = recordCite(params, record);
    return {
      id: record.id,
      name: record.name,
      search: cite,
      taken,
      reach: reachOf({ requires, who: resolved?.who ?? null, ctx }),
      cite,
      meta: extra,
      summary: record.summary,
      blocked,
    };
  };
}
