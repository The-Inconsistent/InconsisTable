"use client";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, type KeyboardEvent } from "react";

import type { AscendKind } from "@inconsistable/core-schema";

import { ascensionRows, type AscensionMember } from "@/lib/ledger/play";

export type AscensionPanelProps = {
  tier: number;
  topTier: number;
  needed: number;
  members: AscensionMember[];
  busy: boolean;
  refusal: string | null;
  onAscend: (a: { kind: AscendKind; waivePackage: boolean }) => void;
};

// The GM's Ascension for the whole group, as Auspex's party panel runs it: who has earned the XP this Tier needs, then
// by experience (once everyone counted is ready) or by milestone (the GM's call, with the Ascension Package waived or
// not). Each takes two presses, since it moves every character's Tier: the first arms it, anything else disarms it.
export function AscensionPanel({ tier, topTier, needed, members, busy, refusal, onAscend }: AscensionPanelProps) {
  const t = useTranslations("ledgerBuilder.play.ascension");
  const id = useId();
  const [armed, setArmed] = useState<AscendKind | null>(null);
  const [sent, setSent] = useState<AscendKind | null>(null);
  const [waive, setWaive] = useState(false);
  const rows = ascensionRows({ tier, topTier, needed, members });
  const allowed: Record<AscendKind, boolean> = { experience: rows.experience, milestone: rows.milestone };

  // The document: a press anywhere but the armed button disarms it (a click doesn't move focus in every browser).
  useEffect(() => {
    if (!armed) return;
    const disarm = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest(".lb-ascend-go[data-state='armed']"))) setArmed(null);
    };
    document.addEventListener("pointerdown", disarm);
    return () => document.removeEventListener("pointerdown", disarm);
  }, [armed]);

  // First press arms this way; the second, on the same button, sends it.
  const handlePress = (kind: AscendKind) => {
    if (armed !== kind) return setArmed(kind);
    setArmed(null);
    setSent(kind);
    onAscend({ kind, waivePackage: kind === "milestone" && waive });
  };
  // Escape disarms.
  const handleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Escape") setArmed(null);
  };
  // The waiver: changing it disarms, so what is confirmed is what is on screen.
  const handleWaive = () => {
    setWaive(!waive);
    setArmed(null);
  };

  const goButton = (kind: AscendKind) => (
    <button
      type="button"
      className={`btn lb-ascend-go${kind === "milestone" ? "" : " primary"}`}
      data-state={armed === kind ? "armed" : undefined}
      disabled={!allowed[kind] || busy}
      aria-busy={busy && sent === kind}
      onClick={() => handlePress(kind)}
      onBlur={() => armed === kind && setArmed(null)}
      onKeyDown={handleKey}
    >
      {armed === kind ? t("confirm", { tier: tier + 1 }) : t(kind)}
    </button>
  );

  return (
    <section className="card stack lb-play lb-ascend" aria-labelledby={id}>
      <h3 id={id} className="lb-sub">
        {t("title")}
      </h3>
      <p className="dim">{rows.atTop ? t("top", { tier }) : t("now", { tier, next: tier + 1 })}</p>

      {rows.counted.length > 0 ? (
        <ul className="list lb-members" aria-label={t("counted")}>
          {rows.counted.map((m) => (
            <li key={m.id} data-state={m.ready ? "ready" : "short"}>
              <span className="lb-row-text">
                <strong>{m.name}</strong>
                <span className="small dim">
                  {t("rank", { rank: m.rank })} · {t("thisTier", { earned: m.earnedThisTier, needed })}
                </span>
              </span>
              <span className="lb-member-state">
                <span aria-hidden>{m.ready ? "✓ " : "○ "}</span>
                {m.ready ? t("ready") : t("short", { count: m.short })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim">{t("nobody")}</p>
      )}
      {rows.gone.length > 0 && (
        <div className="stack">
          <h4 className="lb-member-head">{t("gone")}</h4>
          <ul className="list lb-members" aria-label={t("gone")}>
            {rows.gone.map((m) => (
              <li key={m.id} data-state="gone">
                <span className="lb-row-text">
                  <strong>{m.name}</strong>
                  <span className="small dim">{t("rank", { rank: m.rank })}</span>
                </span>
                <span className="small dim">{t("goneNote")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!rows.atTop && (
        <div className="stack lb-ascend-ways">
          <div className="stack lb-card">
            {goButton("experience")}
            <p className="small dim">
              {rows.experience
                ? t("experienceNote", { needed })
                : rows.counted.length > 0
                  ? t("experienceWaiting", { ready: rows.ready, count: rows.counted.length, needed })
                  : t("nobody")}
            </p>
          </div>
          <div className="stack lb-card">
            {goButton("milestone")}
            <p className="small dim">{t("milestoneNote")}</p>
            <label className="row lb-waive">
              <input type="checkbox" checked={waive} onChange={handleWaive} disabled={busy} />
              <span>{t("waive")}</span>
            </label>
          </div>
          <p className="small" role="status">
            {armed ? t("armedHint") : busy ? t("busy") : ""}
          </p>
        </div>
      )}
      {refusal && (
        <p className="error" role="alert">
          {refusal}
        </p>
      )}
    </section>
  );
}
