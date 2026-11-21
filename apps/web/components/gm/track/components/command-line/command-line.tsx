"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { ActionInput } from "@inconsistable/core-schema";

import { commandWords, parseOrder, type CommandTable, type Said, type Why } from "@/lib/command/command";

type CommandLineProps = {
  /** What an order can name and do here; its words are filled from the messages. */
  table: Omit<CommandTable, "words">;
  run: (a: ActionInput) => Promise<boolean>;
};

// ORDER (house decision #100): one line on the GM's tracker for short orders, each said back as a sentence before
// Enter sends it as the action a tap would; an order that does not parse says why and sends nothing.
export function CommandLine({ table, run }: CommandLineProps) {
  const t = useTranslations("command");
  const [text, setText] = useState("");
  const words = commandWords((v) => t(`words.${v}`));
  const order = parseOrder({ text, table: { ...table, words } });

  // SEND: the parsed order's action; the line clears once it went through.
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!order?.ok) return;
    if (await run(order.action)) setText("");
  };

  // What the order does, in words.
  const said = (s: Said): string => {
    switch (s.kind) {
      case "change":
        return t("said.change", { name: s.name, by: s.by, label: s.label });
      case "condition":
        return t(s.on ? "said.conditionOn" : "said.conditionOff", { name: s.name, label: s.label });
      case "turn":
        return t(`said.${s.verb}`);
      case "mob":
        return t("said.mob", { name: s.name, members: s.members });
      case "visibility":
        return t(s.visibility === "full" ? "said.reveal" : "said.hide", { name: s.name });
      case "pool":
        return t("said.pool", { label: s.label, by: s.by });
    }
  };
  // Why it does not parse.
  const why = (w: Why): string => {
    switch (w.kind) {
      case "noMatch":
        return t("why.noMatch", { words: w.words });
      case "ambiguous":
        return t("why.ambiguous", { names: w.names });
      case "noCondition":
        return t("why.noCondition", { words: w.words });
      default:
        return t(`why.${w.kind}`);
    }
  };

  return (
    <form className="stack command-line" onSubmit={handleSubmit}>
      <label className="row command-input">
        <span>{t("label")}</span>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("aria")}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {order !== null && (
        <output className={order.ok ? "command-said" : "command-why dim"} aria-live="polite">
          {order.ok ? t("willSend", { order: said(order.said) }) : why(order.why)}
        </output>
      )}
    </form>
  );
}
