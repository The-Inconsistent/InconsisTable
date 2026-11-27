"use client";
import { useFormatter, useTranslations } from "next-intl";

import { NEXT_SESSION_FORMAT } from "@/lib/next-session/next-session";

type NextSessionCardProps = {
  campaignId: string;
  /** campaign.nextSessionAt, UTC; nothing is drawn while it is null. */
  at: string | null;
  place: string;
};

// NEXT SESSION on a phone (#220, Auspex P39): when the table meets next, in this phone's own zone, and where, with ADD
// TO CALENDAR, the room's calendar file (any seat may fetch it). It reads only what the seat's state already holds.
export function NextSessionCard({ campaignId, at, place }: NextSessionCardProps) {
  const t = useTranslations("nextSession");
  const format = useFormatter();
  if (!at) return null;
  return (
    <section className="card stack" aria-labelledby="next-session-card">
      <h2 className="head" id="next-session-card">
        {t("heading")}
      </h2>
      <p>
        <strong>{format.dateTime(new Date(at), NEXT_SESSION_FORMAT)}</strong>
        {place && <span className="dim"> · {place}</span>}
      </p>
      <a className="btn" href={`/api/campaigns/${encodeURIComponent(campaignId)}/next.ics`} download>
        {t("addToCalendar")}
      </a>
    </section>
  );
}
