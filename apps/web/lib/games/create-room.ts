import type { z } from "zod";

import { CreateGame, type TableMode } from "@inconsistable/core-schema";

import { ApiMessage, CampaignRef, readJson } from "@/lib/api-reply/api-reply";
import { importFreeform } from "@/lib/freeform/import-freeform";

import type { GameOption } from "./games";

export type CreatedRoom =
  | { ok: true; campaignId: string }
  | { ok: false; reason: "invalid" | "freeform" | "refused" | "failed"; refusal?: z.infer<typeof ApiMessage> };

/**
 * NEW ROOM: the api creates it with the caller as owner and GM (or as a player where there is no GM). A game not yet in
 * the library (Freeform) is imported first. `game` null makes a room with no ruleset.
 */
export async function createRoom({
  name,
  game,
  mode,
}: {
  name: string;
  game: GameOption | null;
  mode: TableMode;
}): Promise<CreatedRoom> {
  let rulesetVersionId = game?.versionId ?? undefined;
  if (game && game.versionId === null) {
    const imported = await importFreeform();
    if (!imported) return { ok: false, reason: "freeform" };
    rulesetVersionId = imported;
  }
  const parsed = CreateGame.safeParse({ name, rulesetVersionId, tableMode: mode === "gm" ? undefined : mode });
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const res = await fetch("/api/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(parsed.data),
  });
  const body = await readJson(res);
  const room = CampaignRef.safeParse(body);
  if (res.ok && room.success) return { ok: true, campaignId: room.data.campaignId };
  const refusal = ApiMessage.safeParse(body);
  return refusal.success ? { ok: false, reason: "refused", refusal: refusal.data } : { ok: false, reason: "failed" };
}
