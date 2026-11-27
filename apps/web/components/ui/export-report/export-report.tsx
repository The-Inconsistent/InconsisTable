"use client";
import { useTranslations } from "next-intl";

import type { RoomExportReport } from "@inconsistable/core-schema";

type ExportReportProps = { name: string; report: RoomExportReport | null };

// What a room export saved and what it left out (#232): the file's name and its pictures, then each count of what named
// a pack the room is no longer served, only when there is some. The GM's EXPORT and the admin card's show the same.
export function ExportReport({ name, report }: ExportReportProps) {
  const t = useTranslations("roomExport");
  return (
    <div className="stack" role="status">
      <p className="small">{t("exported", { name, pictures: report?.pictures ?? 0 })}</p>
      {report && report.packs > 0 && <p className="small">{t("packsLeft", { count: report.packs })}</p>}
      {report && report.items > 0 && <p className="small">{t("itemsTurned", { count: report.items })}</p>}
      {report && report.sources > 0 && <p className="small">{t("sourcesLeft", { count: report.sources })}</p>}
    </div>
  );
}
