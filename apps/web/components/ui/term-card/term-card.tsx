"use client";
import { useTranslations } from "next-intl";
import { type HTMLAttributes, useState } from "react";

import type { BookSource } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { FloatingSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";

/** What a card needs to open a page: the ruleset that names the books, the served books and the page relay. */
export type TermEnv = { ruleset: Ruleset; books: readonly BookSource[]; requestPage: RequestPage };
/** A definition as a card shows it: its name, what it means in the importer's words, and its page. */
export type TermDef = { label: string; summary?: string | null; cite?: string | null };

type TermProps = { term: TermDef; env: TermEnv | undefined } & Omit<HTMLAttributes<HTMLElement>, "children">;

// The card a tapped name opens (house decision #126): the name, the importer's meaning, and the cite, which opens the
// page through the relay while a tablet serves the book (the platform's "full rule": a rule's text is never stored).
function TermCard({ term, env, onClose }: { term: TermDef; env: TermEnv; onClose: () => void }) {
  return (
    <FloatingSheet title={term.label} onClose={onClose}>
      <p className="term-text">{term.summary}</p>
      {term.cite && <Cite cite={term.cite} {...env} />}
    </FloatingSheet>
  );
}

// A name a new player can tap for what it means. Without a summary (or a card to show it in) it stays plain text, so a
// game that writes no meanings looks as it did.
export function Term({ term, env, className, ...rest }: TermProps) {
  const t = useTranslations("term");
  const [open, setOpen] = useState(false);
  if (!term.summary || !env)
    return (
      <span className={className} {...rest}>
        {term.label}
      </span>
    );
  return (
    <>
      <button
        type="button"
        className={className ? `term ${className}` : "term"}
        aria-haspopup="dialog"
        aria-label={t("hint", { label: term.label })}
        onClick={() => setOpen(true)}
        {...rest}
      >
        {term.label}
      </button>
      {open && <TermCard term={term} env={env} onClose={() => setOpen(false)} />}
    </>
  );
}

// ⓘ beside a label in setup: the same card, for a choice the importer explained. Nothing without a summary.
export function TermMark({ term, env }: { term: TermDef; env: TermEnv | undefined }) {
  const t = useTranslations("term");
  const [open, setOpen] = useState(false);
  if (!term.summary || !env) return null;
  return (
    <>
      <button
        type="button"
        className="term-mark"
        aria-haspopup="dialog"
        aria-label={t("mark", { label: term.label })}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open && <TermCard term={term} env={env} onClose={() => setOpen(false)} />}
    </>
  );
}
