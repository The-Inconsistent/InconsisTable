import { RoomImportRefusal, RoomImportReply } from "@inconsistable/core-schema";

import { readJson } from "@/lib/api-reply/api-reply";

export type RoomImport = { ok: true; reply: RoomImportReply } | { ok: false; refusal: RoomImportRefusal | null };

/** What the import answered: the dry run's or the import's reply, the refusal with its path, or null when unreadable. */
export function readRoomImport({ status, body }: { status: number; body: unknown }): RoomImport {
  const reply = RoomImportReply.safeParse(body);
  if (status < 300 && reply.success) return { ok: true, reply: reply.data };
  const refusal = RoomImportRefusal.safeParse(body);
  return { ok: false, refusal: refusal.success ? refusal.data : null };
}

/**
 * IMPORT A ROOM: sends the file as it is, so the page never parses a large document itself; the api reads it whole.
 * A dry run applies it and rolls it back. A fresh start imports it as a new group would start it (house decision #103).
 */
export async function importRoom({
  file,
  dryRun,
  fresh = false,
}: {
  file: Blob;
  dryRun: boolean;
  fresh?: boolean;
}): Promise<RoomImport> {
  const query = new URLSearchParams();
  if (dryRun) query.set("dryRun", "1");
  if (fresh) query.set("fresh", "1");
  const res = await fetch(`/api/campaigns/import${query.size ? `?${query}` : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: file,
  });
  const body = await readJson(res);
  return readRoomImport({ status: res.status, body });
}
