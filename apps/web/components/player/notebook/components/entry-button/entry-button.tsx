"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";

import { MentionText } from "@/components/ui/mention-text/mention-text";
import { firstLine, forYourEyes } from "@/lib/codex/codex";
import { entrySeenKey } from "@/lib/seen/seen";

import type { CardScope } from "../entry-card/entry-card";

// One entry as a compact button (an inbox card, a search hit): title, kind, the first line of its body, and the marks.
// A tap opens its peek.
export function EntryButton({ entry: e, scope }: { entry: CodexEntry; scope: CardScope }) {
  const t = useTranslations("notebook");
  const tKind = useTranslations("codex.kind");
  const tPeek = useTranslations("peek");
  const line = firstLine(e.body);
  return (
    <button className="btn codex-row notebook-row" onClick={() => scope.onPeek(e.id)}>
      <span className="codex-row-text">
        <strong className="codex-row-title">{e.title}</strong>
        <span className="codex-row-meta small">
          <span>{tKind(e.kind)}</span>
          {scope.fresh.has(entrySeenKey(e)) && <span className="chip">{t("new")}</span>}
          {forYourEyes({ entry: e, held: scope.held }) && (
            <span className="chip" data-eyes="only">
              {tPeek("eyesOnly")}
            </span>
          )}
        </span>
        {/* The first line only: a mention in it reads as a name, the button itself opens the entry. */}
        {line && (
          <span className="notebook-row-line small dim">
            <MentionText body={line} entries={scope.entries} />
          </span>
        )}
      </span>
    </button>
  );
}
