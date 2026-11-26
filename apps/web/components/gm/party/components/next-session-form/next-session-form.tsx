"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { NextSessionPlace, type LiveState } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";
import { fromLocalInput, NEXT_SESSION_FORMAT, toLocalInput } from "@/lib/next-session/next-session";

type NextSessionFormProps = {
  campaign: LiveState["campaign"];
  send: Send;
  onError: (error: string | null) => void;
};

// NEXT SESSION (#220, Auspex P37): when and where the table meets next, typed in this tablet's zone and stored as UTC,
// shown on every phone in its own zone. START SESSION clears the date and keeps the place (house decision #85); CLEAR
// does the same. The caller remounts this on a change from elsewhere, so the form starts from the server's values.
export function NextSessionForm({ campaign, send, onError }: NextSessionFormProps) {
  const t = useTranslations("nextSession");
  const format = useFormatter();
  const whenId = useId();
  const placeId = useId();
  const [when, setWhen] = useState(toLocalInput(campaign.nextSessionAt));
  const [place, setPlace] = useState(campaign.nextSessionPlace);

  // SAVE: the date and the place together; an empty date is no date.
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const nextSessionPlace = NextSessionPlace.safeParse(place);
    if (!nextSessionPlace.success) return onError(t("placeInvalid"));
    const r = await send({
      type: "campaign.update",
      nextSessionAt: fromLocalInput(when),
      nextSessionPlace: nextSessionPlace.data,
    });
    onError(r.ok ? null : r.error);
  };
  // CLEAR: the date only; the place stays for the next one.
  const handleClear = async () => {
    const r = await send({ type: "campaign.update", nextSessionAt: null });
    onError(r.ok ? null : r.error);
  };

  return (
    <form className="card stack" onSubmit={handleSave}>
      <h3 className="head">{t("heading")}</h3>
      <p className="small" role="status">
        {campaign.nextSessionAt
          ? [format.dateTime(new Date(campaign.nextSessionAt), NEXT_SESSION_FORMAT), campaign.nextSessionPlace]
              .filter(Boolean)
              .join(" · ")
          : t("none")}
      </p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {/* Side by side on a tablet; each takes the whole row on a phone. */}
        <label className="stack" htmlFor={whenId} style={{ flex: "1 1 220px", minWidth: 0 }}>
          {t("when")}
          <input id={whenId} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label className="stack" htmlFor={placeId} style={{ flex: "1 1 220px", minWidth: 0 }}>
          {t("place")}
          <input
            id={placeId}
            value={place}
            maxLength={200}
            placeholder={t("placeHint")}
            onChange={(e) => setPlace(e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <button className="btn primary">{t("save")}</button>
        {campaign.nextSessionAt && (
          <button type="button" className="btn" onClick={handleClear}>
            {t("clear")}
          </button>
        )}
      </div>
    </form>
  );
}
