"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Clock } from "@inconsistable/core-schema";

import { ClockForm, type ClockValues } from "@/components/gm/track/components/clocks-panel/clock-form";
import { CLOCK_DEFAULTS, type Run } from "@/components/gm/track/constants";
import { ClockFace } from "@/components/ui/clock-face/clock-face";

type ClocksPanelProps = {
  clocks: readonly Clock[];
  entries: readonly { id: string; title: string }[];
  run: Run;
};

// The room's clocks, always at hand on TRACK, fight or no fight. Each is a face, a name, and a large minus and plus; the
// server clamps a tick at empty and full. Deleting asks twice, because a clock's history goes with it.
export function ClocksPanel({ clocks, entries, run }: ClocksPanelProps) {
  const t = useTranslations("clocks");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const titles = new Map(entries.map((e) => [e.id, e.title]));

  // CREATE: adds a clock, then closes the form.
  const handleCreate = async (v: ClockValues) => {
    const ok = await run({
      type: "clock.create",
      name: v.name,
      segments: v.segments,
      visibility: v.visibility,
      ...(v.entryId ? { entryId: v.entryId } : {}),
    });
    if (ok) setAdding(false);
    return ok;
  };

  // SAVE: patches one clock with the form's fields, then closes the form.
  const handleSave = (id: string) => async (v: ClockValues) => {
    const ok = await run({ type: "clock.update", id, ...v });
    if (ok) setEditing(null);
    return ok;
  };

  // DELETE: the first tap asks, the second removes the clock.
  const handleDelete = async (id: string) => {
    if (deleting !== id) return setDeleting(id);
    setDeleting(null);
    await run({ type: "clock.delete", id });
  };

  return (
    <section className="stack clocks-panel" aria-label={t("title")}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="head">{t("title")}</h2>
        {!adding && (
          <button className="btn sm" onClick={() => setAdding(true)}>
            {t("add")}
          </button>
        )}
      </div>
      {adding && (
        <div className="card">
          <ClockForm
            initial={CLOCK_DEFAULTS}
            entries={entries}
            submitLabel={t("create")}
            onSubmit={handleCreate}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}
      {clocks.length === 0 && !adding && <p className="dim">{t("empty")}</p>}
      <ul className="clock-grid">
        {clocks.map((clock) => (
          <li key={clock.id} className="clock-tile card" data-visibility={clock.visibility}>
            {editing === clock.id ? (
              <ClockForm
                initial={clock}
                entries={entries}
                submitLabel={t("save")}
                onSubmit={handleSave(clock.id)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <>
                <ClockFace clock={clock} />
                <span className="clock-name">{clock.name}</span>
                <span className="clock-count">
                  {clock.filled === clock.segments
                    ? t("full")
                    : t("progress", { filled: clock.filled, segments: clock.segments })}
                </span>
                <span className="row">
                  <span className="chip">{t(clock.visibility)}</span>
                  {clock.entryId && titles.has(clock.entryId) && (
                    <span className="chip">{t("about", { title: titles.get(clock.entryId) ?? "" })}</span>
                  )}
                </span>
                <span className="row clock-ticks">
                  <button
                    className="btn clock-step"
                    aria-label={t("minus", { name: clock.name })}
                    disabled={clock.filled === 0}
                    onClick={() => run({ type: "clock.tick", id: clock.id, delta: -1 })}
                  >
                    −
                  </button>
                  <button
                    className="btn primary clock-step"
                    aria-label={t("plus", { name: clock.name })}
                    disabled={clock.filled === clock.segments}
                    onClick={() => run({ type: "clock.tick", id: clock.id, delta: 1 })}
                  >
                    +
                  </button>
                </span>
                {deleting === clock.id ? (
                  <span className="stack">
                    <span role="alert">{t("deleteConfirm", { name: clock.name })}</span>
                    <span className="row">
                      <button className="btn sm" onClick={() => handleDelete(clock.id)}>
                        {t("deleteYes")}
                      </button>
                      <button className="btn sm" onClick={() => setDeleting(null)}>
                        {t("cancel")}
                      </button>
                    </span>
                  </span>
                ) : (
                  <span className="row">
                    <button
                      className="btn sm"
                      aria-label={t("edit", { name: clock.name })}
                      onClick={() => setEditing(clock.id)}
                    >
                      {t("editButton")}
                    </button>
                    <button
                      className="btn sm"
                      aria-label={t("delete", { name: clock.name })}
                      onClick={() => handleDelete(clock.id)}
                    >
                      {t("deleteButton")}
                    </button>
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
