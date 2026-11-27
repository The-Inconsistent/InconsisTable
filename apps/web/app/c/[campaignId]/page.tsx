import type { Viewport } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { cache } from "react";

import { Me } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { apiGet } from "@/app/server-api";
import { ADMIN_PARAM } from "@/lib/admin/admin";
import { GmApp } from "@/components/gm/gm-app/gm-app";
import { PlayerApp } from "@/components/player/player-app/player-app";
import { TableScreen } from "@/components/screen/table-screen/table-screen";
import { RoomWorld } from "@/components/ui/room-world/room-world";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { creatureTypes } from "@/lib/creatures/creatures";
import { PackList, RulesReply, RulesetList, WorldList, type RulesTabData } from "@/lib/library/library";
import { RULES_PAGE, type RulesView } from "@/lib/rules-reader/rules-reader";
import type { Spawnable } from "@/lib/scene-prep/scene-prep";
import { resolveScheme, SCHEME_COOKIE, schemeAttribute } from "@/lib/theme/theme";
import { roomBand } from "@/lib/world/room";

type TableProps = {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// What the GM's Rules tab shows: the room's pin, attached packs and World, and the caller's own rulesets, packs and
// Worlds. Read here so the tab needs no fetch of its own; it asks the page to refresh after a pin or an attach. Null
// when any read fails.
async function rulesTab(campaignId: string): Promise<RulesTabData | null> {
  try {
    const [rulesets, packs, worlds, room] = await Promise.all([
      apiGet("/api/rulesets"),
      apiGet("/api/packs"),
      apiGet("/api/worlds"),
      apiGet(`/api/campaigns/${campaignId}/rules?limit=1`),
    ]);
    const parsed = {
      rulesets: RulesetList.safeParse(rulesets.ok ? await rulesets.json() : null),
      packs: PackList.safeParse(packs.ok ? await packs.json() : null),
      worlds: WorldList.safeParse(worlds.ok ? await worlds.json() : null),
      room: RulesReply.safeParse(room.ok ? await room.json() : null),
    };
    if (!parsed.rulesets.success || !parsed.packs.success || !parsed.worlds.success || !parsed.room.success)
      return null;
    const { ruleset, packs: attached, world } = parsed.room.data;
    return {
      rulesets: parsed.rulesets.data,
      packs: parsed.packs.data,
      worlds: parsed.worlds.data,
      pinned: ruleset && { versionId: ruleset.versionId, slug: ruleset.slug, version: ruleset.version },
      attached,
      world: world && { versionId: world.versionId, name: world.name, version: world.version },
    };
  } catch {
    return null;
  }
}

// The ruleset as this seat may read it and the first entries of the attached packs, for the sheet and the RULES reader.
// Null when the read fails; a manifest that does not parse leaves `ruleset` null, so the sheet shows nothing wrong.
// Cached for the request: the viewport below and the page read it once between them.
const rulesView = cache(async (campaignId: string): Promise<RulesView | null> => {
  try {
    const res = await apiGet(`/api/campaigns/${campaignId}/rules?limit=${RULES_PAGE}`);
    const first = RulesReply.safeParse(res.ok ? await res.json() : null);
    if (!first.success) return null;
    const ruleset = Ruleset.safeParse(first.data.ruleset?.manifest);
    return { ruleset: ruleset.success ? ruleset.data : null, first: first.data };
  } catch {
    return null;
  }
});

// The browser's colour in a room wearing a World is the World's band (house decision #208); without one, layout.tsx's.
export async function generateViewport({ params }: Pick<TableProps, "params">): Promise<Viewport> {
  const { campaignId } = await params;
  // The scheme switch refreshes the page, so a new pick reaches the browser's colour through this too.
  const picked = schemeAttribute(resolveScheme((await cookies()).get(SCHEME_COOKIE)?.value));
  const band = roomBand({ world: (await rulesView(campaignId))?.first.world ?? null, picked });
  return band ? { themeColor: band } : {};
}

// The most entries of one creature type a read of the rules route answers (the api's own page limit).
const SPAWNABLE_PAGE = 500;

// What a scene's roster lines are resolved against (house decision #73): the attached packs and their creatures, read
// once here as the creature search reads them. Null when a read fails, so no line is called broken for it.
// ponytail: 500 creatures of a type, beyond them a line is sendable unchecked (complete: false); a key filter on the
// rules route when a pack holds more.
async function spawnable(campaignId: string, ruleset: Ruleset | null): Promise<Spawnable | null> {
  if (!ruleset) return { packs: [], entries: [], complete: true };
  try {
    const replies = await Promise.all(
      creatureTypes(ruleset).map(async (type) => {
        const res = await apiGet(
          `/api/campaigns/${campaignId}/rules?type=${encodeURIComponent(type)}&limit=${SPAWNABLE_PAGE}`,
        );
        const parsed = RulesReply.safeParse(res.ok ? await res.json() : null);
        if (!parsed.success) throw new Error("rules read failed");
        return parsed.data;
      }),
    );
    const packs = replies[0]?.packs ?? [];
    return {
      packs: packs.map((p) => ({ slug: p.slug, id: p.id })),
      entries: replies.flatMap((r) =>
        r.entries.map((e) => ({ pack: e.pack, key: e.key, type: e.type, name: e.name, body: e.body })),
      ),
      complete: replies.every((r) => r.entries.length >= r.total),
    };
  } catch {
    return null;
  }
}

// One table: the GM app (GM, co-GM, or an admin who opened it), the player app, or the table screen, by the caller's
// seat. The api decides what each seat may do; the app only hides what it can't.
export default async function Table({ params, searchParams }: TableProps) {
  const [p, query, t] = await Promise.all([params, searchParams, getTranslations("status")]);
  const campaignId = encodeURIComponent(p.campaignId);
  let me: Me;
  if (query[ADMIN_PARAM] !== undefined) {
    // OPEN AS ADMIN: the key never reaches this server (it lives in the admin's tab), so the page only draws the GM shell.
    // The socket proves the key; without it nothing loads. The rules tabs need a seat's cookie, so they stay empty.
    // ponytail: no rules tabs as admin, pass the key through a server-readable cookie if admins need them
    me = { campaignId: p.campaignId, userId: null, campaignOwnerId: null, tableMode: "gm", seat: { kind: "admin" } };
    // No World without a seat's rules, but the GM tabs still need the providers RoomWorld mounts (handouts).
    return (
      <RoomWorld world={null}>
        <GmApp me={me} rules={null} view={null} spawnable={null} />
      </RoomWorld>
    );
  }
  try {
    const res = await apiGet(`/api/campaigns/${campaignId}/me`);
    if (res.status === 400 || res.status === 401) return <StatusScreen text={t("noAccess")} />;
    const parsed = Me.safeParse(res.ok ? await res.json() : null);
    if (!parsed.success) return <StatusScreen text={t("nosignal")} />;
    me = parsed.data;
  } catch {
    return <StatusScreen text={t("nosignal")} />;
  }

  // Every seat wears the room's World, read with the rules it already reads (docs/adr/0010, decision 2).
  const seat = me.seat;
  if (seat.kind === "admin" || (seat.kind === "member" && seat.role !== "player")) {
    const [rules, view] = await Promise.all([rulesTab(campaignId), rulesView(campaignId)]);
    const creatures = view ? await spawnable(campaignId, view.ruleset) : null;
    return (
      <RoomWorld world={view?.first.world ?? null}>
        <GmApp me={me} rules={rules} view={view} spawnable={creatures} quick={query.quick === "1"} />
      </RoomWorld>
    );
  }
  if (seat.kind === "token" && seat.role === "screen") {
    const view = await rulesView(campaignId);
    return (
      <RoomWorld world={view?.first.world ?? null}>
        <TableScreen campaignId={me.campaignId} view={view} />
      </RoomWorld>
    );
  }
  // Without a GM the owner runs the table from their phone, with a character or not.
  const runsTheRoom = me.tableMode !== "gm" && me.userId !== null && me.userId === me.campaignOwnerId;
  if (!seat.characterIds.length && !runsTheRoom) return <StatusScreen text={t("noCharacter")} />;
  const view = await rulesView(campaignId);
  return (
    <RoomWorld world={view?.first.world ?? null}>
      <PlayerApp me={me} view={view} quick={query.quick === "1"} />
    </RoomWorld>
  );
}
