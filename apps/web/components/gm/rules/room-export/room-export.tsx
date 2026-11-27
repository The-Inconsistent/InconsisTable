"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Me, RoomExportReport } from "@inconsistable/core-schema";

import { ExportReport } from "@/components/ui/export-report/export-report";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import { saveExport } from "@/lib/room-export/room-export";

type RoomExportProps = { me: Me; pictures: number };

// EXPORT: the room as its document (house decision #103), for its owner while they run it, as the api allows. The file
// is fetched here with the seat's own cookie and handed to the browser, so the page can say what the export left out
// (#232). WITHOUT PICTURES is the small file for a room whose pictures would put it over what an import takes, shown, as
// Auspex shows it, only when the room has pictures; the owner of a room without a GM may not see every picture, so it is
// always there.
export function RoomExport({ me, pictures }: RoomExportProps) {
  const t = useTranslations("roomExport");
  const refusal = useRefusal();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; report: RoomExportReport | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = me.userId !== null && me.userId === me.campaignOwnerId;
  const runs = me.tableMode !== "gm" || (me.seat.kind === "member" && me.seat.role === "gm");
  if (!owner || !runs) return null;
  const counted = me.tableMode === "gm";

  // EXPORT and WITHOUT PICTURES: fetches the file, saves it, and says what it carried and left out, or why it was refused.
  const handleExport = async (withPictures: boolean) => {
    setBusy(true);
    setDone(null);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${me.campaignId}/export${withPictures ? "" : "?pictures=0"}`);
      if (res.ok) setDone(await saveExport(res));
      else {
        const body = ApiMessage.safeParse(await readJson(res));
        setError(body.success ? refusal({ code: body.data.code, message: body.data.message }) : t("failed"));
      }
    } catch {
      setError(t("failed"));
    }
    setBusy(false);
  };

  return (
    <section className="stack">
      <h2 className="head">{t("title")}</h2>
      <p className="small dim">{t("lede")}</p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={busy} onClick={() => void handleExport(true)}>
          {t("export")}
        </button>
        {counted && pictures > 0 && <span className="small dim">{t("includes", { count: pictures })}</span>}
        {(!counted || pictures > 0) && (
          <button type="button" className="btn" disabled={busy} onClick={() => void handleExport(false)}>
            {t("withoutPictures")}
          </button>
        )}
      </div>
      {done && <ExportReport name={done.name} report={done.report} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
