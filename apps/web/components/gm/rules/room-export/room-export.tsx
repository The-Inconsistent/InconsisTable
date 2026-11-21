"use client";
import { useTranslations } from "next-intl";

import type { Me } from "@inconsistable/core-schema";

// EXPORT: the room as its document (house decision #103), for its owner while they run it, as the api allows. Plain
// download links: the browser GETs the file with the seat's own cookie, and nothing passes through the page. WITHOUT
// PICTURES is the small file for a room whose pictures would put it over what an import takes.
export function RoomExport({ me }: { me: Me }) {
  const t = useTranslations("roomExport");
  const owner = me.userId !== null && me.userId === me.campaignOwnerId;
  const runs = me.tableMode !== "gm" || (me.seat.kind === "member" && me.seat.role === "gm");
  if (!owner || !runs) return null;
  const href = `/api/campaigns/${me.campaignId}/export`;
  return (
    <section className="stack">
      <h2 className="head">{t("title")}</h2>
      <p className="small dim">{t("lede")}</p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <a className="btn" href={href} download>
          {t("export")}
        </a>
        <a className="btn" href={`${href}?pictures=0`} download>
          {t("withoutPictures")}
        </a>
      </div>
    </section>
  );
}
