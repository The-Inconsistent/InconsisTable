"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState, type CSSProperties } from "react";

import type { LiveState } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import { useLogWords } from "@/hooks/use-log-words/use-log-words";
import type { Send } from "@/hooks/use-table/use-table";
import { historyLines, type HistoryEntry } from "@/lib/fight-log/fight-log";

type HistoryButtonProps = { state: LiveState; ruleset: Ruleset | null; send: Send };

// HISTORY in the GM's header (house decision #133): the running session's actions, newest first, worded as the fight's
// log words them, with UNDO on a standing line and REDO on one taken back. The server decides: a refusal ("a later step
// changed …") shows at the top, and the line it names is marked to undo first.
export function HistoryButton({ state, ruleset, send }: HistoryButtonProps) {
  const t = useTranslations("history");
  const tHeader = useTranslations("gmApp.header");
  const format = useFormatter();
  const words = useLogWords();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<{ text: string; first: string | null } | null>(null);
  const names = useMemo(() => new Map(state.actors.map((a) => [a.id, a])), [state.actors]);
  const lines = historyLines({ history: state.history ?? [], names, ruleset });

  // UNDO or REDO of one line; a refusal keeps the line it names (the later step to undo first).
  const handleLine = async (line: HistoryEntry) => {
    const r = await send({ type: line.undone ? "event.redo" : "event.undo", actionId: line.id });
    const first = r.ok ? undefined : r.params?.actionId;
    setRefusal(r.ok ? null : { text: r.error, first: typeof first === "string" ? first : null });
  };

  // Closing forgets the refusal, so the next opening starts clean.
  const handleClose = () => {
    setOpen(false);
    setRefusal(null);
  };

  return (
    <>
      <button className="btn" aria-expanded={open} onClick={() => (open ? handleClose() : setOpen(true))}>
        {tHeader("history")}
      </button>
      {open && (
        <BottomSheet title={t("title")} onClose={handleClose}>
          {refusal && (
            <p className="error" role="alert">
              {refusal.text}
            </p>
          )}
          {state.session === null ? (
            <p className="dim">{t("noSession")}</p>
          ) : lines.length === 0 ? (
            <p className="dim">{t("empty")}</p>
          ) : (
            <ol className="history-list rise-list">
              {lines.map((line, i) => {
                const text = line.parts.map(words).join("; ");
                const first = refusal?.first === line.id;
                return (
                  <li
                    key={line.id}
                    className="history-line"
                    data-state={line.undone ? "undone" : "live"}
                    data-first={first || undefined}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <time className="small dim" dateTime={line.at}>
                      {format.dateTime(new Date(line.at), { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    <span className="history-what">
                      {line.undone ? (
                        <>
                          <s>{text}</s> <span className="dim">{t("undone")}</span>
                        </>
                      ) : (
                        text
                      )}
                      {first && <strong className="history-first"> {t("first")}</strong>}
                    </span>
                    <button
                      className="btn sm"
                      aria-label={t(line.undone ? "redoLine" : "undoLine", { line: text })}
                      onClick={() => handleLine(line)}
                    >
                      {t(line.undone ? "redo" : "undo")}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </BottomSheet>
      )}
    </>
  );
}
