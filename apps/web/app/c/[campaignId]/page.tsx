import { getTranslations } from "next-intl/server";

import { Me } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { apiGet } from "@/app/server-api";
import { ADMIN_PARAM } from "@/lib/admin/admin";
import { asGmTab, TAB_PARAM } from "@/components/gm/gm-app/constants";
import { GmApp } from "@/components/gm/gm-app/gm-app";
import { PlayerApp } from "@/components/player/player-app/player-app";
import { TableScreen } from "@/components/screen/table-screen/table-screen";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { PackList, RulesReply, RulesetList, type RulesTabData } from "@/lib/library/library";
import { RULES_PAGE, type RulesView } from "@/lib/rules-reader/rules-reader";

type TableProps = {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// What the GM's Rules tab shows: the room's pin and attached packs, and the caller's own rulesets and packs. Read here so
// the tab needs no fetch of its own; it asks the page to refresh after a pin or an attach. Null when any read fails.
async function rulesTab(campaignId: string): Promise<RulesTabData | null> {
  try {
    const [rulesets, packs, room] = await Promise.all([
      apiGet("/api/rulesets"),
      apiGet("/api/packs"),
      apiGet(`/api/campaigns/${campaignId}/rules?limit=1`),
    ]);
    const parsed = {
      rulesets: RulesetList.safeParse(rulesets.ok ? await rulesets.json() : null),
      packs: PackList.safeParse(packs.ok ? await packs.json() : null),
      room: RulesReply.safeParse(room.ok ? await room.json() : null),
    };
    if (!parsed.rulesets.success || !parsed.packs.success || !parsed.room.success) return null;
    const { ruleset, packs: attached } = parsed.room.data;
    return {
      rulesets: parsed.rulesets.data,
      packs: parsed.packs.data,
      pinned: ruleset && { versionId: ruleset.versionId, slug: ruleset.slug, version: ruleset.version },
      attached,
    };
  } catch {
    return null;
  }
}

// The ruleset as this seat may read it and the first entries of the attached packs, for the sheet and the RULES reader.
// Null when the read fails; a manifest that does not parse leaves `ruleset` null, so the sheet shows nothing wrong.
async function rulesView(campaignId: string): Promise<RulesView | null> {
  try {
    const res = await apiGet(`/api/campaigns/${campaignId}/rules?limit=${RULES_PAGE}`);
    const first = RulesReply.safeParse(res.ok ? await res.json() : null);
    if (!first.success) return null;
    const ruleset = Ruleset.safeParse(first.data.ruleset?.manifest);
    return { ruleset: ruleset.success ? ruleset.data : null, first: first.data };
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
    me = { campaignId: p.campaignId, userId: null, campaignOwnerId: null, seat: { kind: "admin" } };
    return <GmApp me={me} initialTab={asGmTab(query[TAB_PARAM])} rules={null} view={null} />;
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

  const seat = me.seat;
  if (seat.kind === "admin" || (seat.kind === "member" && seat.role !== "player"))
    return (
      <GmApp
        me={me}
        initialTab={asGmTab(query[TAB_PARAM])}
        rules={await rulesTab(campaignId)}
        view={await rulesView(campaignId)}
      />
    );
  if (seat.kind === "token" && seat.role === "screen") return <TableScreen campaignId={me.campaignId} />;
  if (!seat.characterIds.length) return <StatusScreen text={t("noCharacter")} />;
  return <PlayerApp me={me} view={await rulesView(campaignId)} />;
}
