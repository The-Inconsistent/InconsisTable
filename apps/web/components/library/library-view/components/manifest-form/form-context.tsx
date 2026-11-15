"use client";
import { createContext, useContext } from "react";

import type { Problem, Ruleset } from "@inconsistable/rules-engine";

import type { FormKind, Path } from "@/lib/manifest-form/manifest-form";

export type OwnRuleset = { id: string; slug: string };

/** What every field of the form reads and writes: the document, and what the validator said about it. */
export interface FormState {
  kind: FormKind;
  doc: unknown;
  problems: readonly Problem[];
  warnings: readonly Problem[];
  /** Every source homebrew (a ruleset), or the target is (a pack): a cite is optional. */
  citeOptional: boolean;
  /** A private document: long descriptions draw a warning. */
  priv: boolean;
  /** The ruleset a pack form checks entries against, when one was loaded. */
  target: Ruleset | null;
  /** The rulesets the user already has, offered when naming the target of a pack. */
  rulesets: readonly OwnRuleset[];
  set: (path: Path, value: unknown) => void;
  remove: (path: Path) => void;
  /** A change that touches more than one place: the current document in, the next one out. */
  edit: (fn: (doc: unknown) => unknown) => void;
}

const FormContext = createContext<FormState | null>(null);
export const FormProvider = FormContext.Provider;

export function useForm(): FormState {
  const ctx = useContext(FormContext);
  if (!ctx) throw new Error("useForm outside a FormProvider");
  return ctx;
}
