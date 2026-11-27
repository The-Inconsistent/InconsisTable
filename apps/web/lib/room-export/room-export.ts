import { RoomExportReport } from "@inconsistable/core-schema";

/** What the export says of itself (#232), from its `X-Room-Export` header; null when missing or unreadable. */
export function exportReport(header: string | null): RoomExportReport | null {
  try {
    const parsed = RoomExportReport.safeParse(JSON.parse(header ?? ""));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The file name the export gives in its `Content-Disposition`, or a plain one. */
export function exportName(header: string | null): string {
  return /filename="([^"]+)"/.exec(header ?? "")?.[1] ?? "room.room.json";
}

/** How many pictures the export carries: each one an entry of the codex names (Auspex's count, house decision #103). */
export function pictureCount(entries: readonly { imageId: string | null }[]): number {
  return new Set(entries.flatMap((e) => (e.imageId ? [e.imageId] : []))).size;
}

/** Hands an export's file to the browser as a download, and answers its name and what it says of itself. */
export async function saveExport(res: Response): Promise<{ name: string; report: RoomExportReport | null }> {
  const name = exportName(res.headers.get("content-disposition"));
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  return { name, report: exportReport(res.headers.get("x-room-export")) };
}
