import { getLocale, getTranslations } from "next-intl/server";

import { Me } from "@inconsistable/core-schema";
import { localRuleset } from "@inconsistable/rules-engine";

import { apiGet } from "@/app/server-api";
import { Builder } from "@/components/builder/builder";
import { RoomWorld } from "@/components/ui/room-world/room-world";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { RulesReply, type RulesEntry } from "@/lib/library/library";

type BuildProps = {
  params: Promise<{ campaignId: string; actorId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// ponytail: a step lists at most 500 entries of a type, page or search once a pack holds more
const MAX_PICKS = 500;

// BUILD CHARACTER for one actor. The ruleset and the entries a step may pick are read here, on the server, through the
// seat-scoped rules route (a player is never sent a GM-only entry); the form then runs on the client. A ruleset with a
// ledger builder also reads the seat, and the client picks the builder once it knows the actor.
export default async function Build({ params, searchParams }: BuildProps) {
  const [p, query, t] = await Promise.all([params, searchParams, getTranslations("status")]);
  // The step a link asks for (`?step=advance`, from the sheet's XP box), read here so the first render already has it.
  const step = typeof query["step"] === "string" ? query["step"] : null;
  const campaignId = encodeURIComponent(p.campaignId);
  try {
    const res = await apiGet(`/api/campaigns/${campaignId}/rules?limit=1`);
    if (res.status === 400 || res.status === 401 || res.status === 403) return <StatusScreen text={t("noAccess")} />;
    const room = RulesReply.safeParse(res.ok ? await res.json() : null);
    if (!room.success) return <StatusScreen text={t("nosignal")} />;
    if (!room.data.ruleset) return <StatusScreen text={t("noRuleset")} />;
    const ruleset = localRuleset(room.data.ruleset.manifest, await getLocale());
    if (!ruleset) return <StatusScreen text={t("nosignal")} />;

    // A ledger ruleset (house decision #62): the seat decides whether this user is on the actor's GM side.
    let me: Me | undefined;
    if (ruleset.build) {
      const res = await apiGet(`/api/campaigns/${campaignId}/me`);
      const mine = Me.safeParse(res.ok ? await res.json() : null);
      if (!mine.success) return <StatusScreen text={t("nosignal")} />;
      me = mine.data;
    }

    const types = [...new Set(ruleset.creation.flatMap((s) => (s.kind === "choose" ? [s.pick] : [])))];
    const replies = await Promise.all(
      types.map(async (type) => {
        const r = await apiGet(
          `/api/campaigns/${campaignId}/rules?type=${encodeURIComponent(type)}&limit=${MAX_PICKS}`,
        );
        return { type, reply: RulesReply.safeParse(r.ok ? await r.json() : null) };
      }),
    );
    const entries: Record<string, RulesEntry[]> = {};
    for (const { type, reply } of replies) {
      if (!reply.success) return <StatusScreen text={t("nosignal")} />;
      entries[type] = reply.data.entries;
    }
    const world = room.data.world;
    return (
      <RoomWorld world={world} ruleset={ruleset}>
        <Builder
          campaignId={p.campaignId}
          actorId={p.actorId}
          ruleset={ruleset}
          entries={entries}
          me={me}
          step={step}
          worldVersionId={world?.versionId ?? null}
          packs={room.data.packs.map((pack) => pack.slug)}
        />
      </RoomWorld>
    );
  } catch {
    return <StatusScreen text={t("nosignal")} />;
  }
}
