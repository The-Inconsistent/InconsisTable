"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";

import { CodexTitle, type ActionInput, type ActionResult, type CodexEntry } from "@inconsistable/core-schema";

type ObjectivesProps = {
  actor: { id: string; name: string };
  /** The quests listed to this character (`objectivesOf`). */
  objectives: readonly CodexEntry[];
  /** Every quest of the room, for the link an objective sits under. */
  quests: readonly CodexEntry[];
  /** Sends an action and shows its refusal on the drawer's error line. */
  act: (a: ActionInput) => Promise<ActionResult>;
  /** Sends an action without touching the error line (a clean-up after a refusal keeps that refusal shown). */
  send: (a: ActionInput) => Promise<ActionResult>;
};

// OBJECTIVES (house decision #223, as Auspex's): the quests revealed to this character alone, which only its player sees
// (the notebook's YOUR ORDERS). DONE is the quest's status, the select the quest it sits under, × takes it from this
// character (seals it back to the GM's codex when it was the only reader; nothing is deleted from here), ADD writes a
// quest and lists it to this character.
export function Objectives({ actor, objectives, quests, act, send }: ObjectivesProps) {
  const t = useTranslations("party.objectives");
  const newId = useId();
  const [text, setText] = useState("");

  // The done box: the quest's status, done or open again.
  const handleDone = (e: CodexEntry) =>
    act({ type: "codex.save", id: e.id, kind: "quest", status: e.status === "done" ? "open" : "done" });

  // The link: the quest it sits under, or none.
  const handleLink = (e: CodexEntry) => (ev: ChangeEvent<HTMLSelectElement>) =>
    void act({ type: "codex.move", id: e.id, parentId: ev.target.value || null, position: 0 });

  // ×: off this character's list; a quest no one else reads is sealed back to the GM's codex, where it is kept.
  const handleRemove = (e: CodexEntry) => {
    const others = e.audience.filter((id) => id !== actor.id);
    return others.length > 0
      ? act({ type: "codex.reveal", id: e.id, visibility: e.visibility, audienceMode: "listed", audience: others })
      : act({ type: "codex.reveal", id: e.id, visibility: "gm", audienceMode: "all", audience: [] });
  };

  // ADD: a new open quest, then listed to this character. When the listing is refused, the quest just made (nothing
  // else holds it yet) is taken back, the text stays in the box and the refusal stays shown.
  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    const title = CodexTitle.safeParse(text);
    if (!title.success) return;
    const made = await act({ type: "codex.save", kind: "quest", title: title.data, status: "open" });
    if (!made.ok || !made.id) return;
    const listed = await act({
      type: "codex.reveal",
      id: made.id,
      visibility: "party",
      audienceMode: "listed",
      audience: [actor.id],
    });
    if (listed.ok) setText("");
    else await send({ type: "codex.delete", id: made.id });
  };

  return (
    <section className="stack" aria-labelledby={`${newId}-head`}>
      <h3 className="head" id={`${newId}-head`}>
        {t("heading", { name: actor.name })}
      </h3>
      {objectives.length === 0 && <p className="dim small">{t("none")}</p>}
      <ul className="list">
        {objectives.map((e) => (
          <li key={e.id} className="party-objective" data-done={e.status === "done"}>
            <label className="row" style={{ flex: "1 1 200px", minWidth: 0, minHeight: 44 }}>
              <input type="checkbox" checked={e.status === "done"} onChange={() => void handleDone(e)} />
              <span className="party-objective-text">{e.title}</span>
            </label>
            <span className="row" style={{ flexWrap: "nowrap" }}>
              <select aria-label={t("linkLabel", { title: e.title })} value={e.parentId ?? ""} onChange={handleLink(e)}>
                <option value="">{t("noLink")}</option>
                {quests
                  .filter((q) => q.id !== e.id)
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title}
                    </option>
                  ))}
              </select>
              <button
                className="btn sm"
                aria-label={t("removeLabel", { title: e.title, name: actor.name })}
                onClick={() => void handleRemove(e)}
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={handleAdd}>
        <input
          id={newId}
          aria-label={t("new")}
          placeholder={t("new")}
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="btn" disabled={text.trim() === ""}>
          {t("add")}
        </button>
      </form>
    </section>
  );
}
