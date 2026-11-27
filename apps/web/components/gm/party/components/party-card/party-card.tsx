"use client";
import { useTranslations } from "next-intl";

import type { Actor } from "@inconsistable/core-schema";

import { ActorPicture } from "@/components/ui/actor-picture/actor-picture";
import type { PartyCard as CardModel } from "@/lib/party-card/party-card";

type PartyCardProps = {
  campaignId: string;
  actor: Actor;
  card: CardModel;
  /** Who plays it, or null for an open seat. */
  holder: string | null;
  objectives: { total: number; done: number };
  onOpen: (actorId: string) => void;
};

// One character on PARTY (house decision #222): its picture, name, line and player, its health as bars, its other
// numbers in one line, the states that hold and its objectives. The whole card is one button: it opens the drawer.
export function PartyCard({ campaignId, actor, card, holder, objectives, onOpen }: PartyCardProps) {
  const t = useTranslations("party");
  return (
    // Its name is its text (name, player, each bar's numbers), read in full; the drawer it opens is a dialog.
    <button className="card party-card" aria-haspopup="dialog" onClick={() => onOpen(actor.id)}>
      <span className="party-card-head">
        <ActorPicture campaignId={campaignId} actor={actor} />
        <span className="stack" style={{ gap: 2, minWidth: 0 }}>
          <strong className="party-card-name">{actor.name}</strong>
          {card.line && <span className="small dim">{card.line}</span>}
          <span className="small">{holder ? t("playedBy", { name: holder }) : t("openSeat")}</span>
        </span>
      </span>
      {card.bars.map((b) => {
        const percent = Math.round((b.left / b.max) * 100);
        return (
          <span key={b.id} className="party-vital" data-stat={b.id}>
            <span className="small">{b.label}</span>
            <span
              className="bar"
              role="img"
              aria-label={t("barLabel", { label: b.label, left: b.left, max: b.max })}
              data-low={percent <= 25}
            >
              <span style={{ transform: `scaleX(${percent / 100})` }} />
            </span>
            <strong className="small party-num">{t("leftOf", { left: b.left, max: b.max })}</strong>
          </span>
        );
      })}
      {card.numbers.length > 0 && (
        <span className="small party-numbers">
          {card.numbers.map((n) => (
            <span key={n.id} data-stat={n.id}>
              {n.label} <strong>{n.value}</strong>
            </span>
          ))}
        </span>
      )}
      {(card.states.length > 0 || objectives.total > 0) && (
        <span className="row small" style={{ gap: 6 }}>
          {card.states.map((s) => (
            <span key={s} className="chip" data-state="health">
              {s}
            </span>
          ))}
          {objectives.total > 0 && (
            <span className="chip" data-objectives="true">
              {t("objectivesLine", objectives)}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
