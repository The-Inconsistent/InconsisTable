"use client";
import { useMessages } from "next-intl";
import { useCallback } from "react";

import { type TermId, termWord } from "@inconsistable/rules-engine";

import type { TermSet } from "@/lib/terms/terms";

/**
 * The room's word for one of the app's terms (issue #159), where a component needs the word outside a message: the
 * World's, else the ruleset's, else the app's own, in the viewer's language. Messages name their terms themselves
 * (`[party]`), so a label in a message needs no hook.
 */
export function useTerm(): (id: TermId, { plural }?: { plural?: boolean }) => string {
  const terms: TermSet = useMessages().terms;
  return useCallback((id, { plural = false } = {}) => termWord(terms[id], plural), [terms]);
}
