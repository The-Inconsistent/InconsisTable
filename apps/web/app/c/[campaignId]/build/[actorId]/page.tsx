import { getTranslations } from "next-intl/server";

import { Ruleset } from "@inconsistable/rules-engine";

import { apiGet } from "@/app/server-api";
import { Builder } from "@/components/builder/builder";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { RulesReply, type RulesEntry } from "@/lib/library/library";

type BuildProps = { params: Promise<{ campaignId: string; actorId: string }> };

// ponytail: a step lists at most 500 entries of a type, page or search once a pack holds more
const MAX_PICKS = 500;

// BUILD CHARACTER for one actor. The ruleset and the entries a step may pick are read here, on the server, through the
// seat-scoped rules route (a player is never sent a GM-only entry); the form then runs on the client.
export default async function Build({ params }: BuildProps) {
  const [p, t] = await Promise.all([params, getTranslations("status")]);
  const campaignId = encodeURIComponent(p.campaignId);
  try {
    const res = await apiGet(`/api/campaigns/${campaignId}/rules?limit=1`);
    if (res.status === 400 || res.status === 401 || res.status === 403) return <StatusScreen text={t("noAccess")} />;
    const room = RulesReply.safeParse(res.ok ? await res.json() : null);
    if (!room.success) return <StatusScreen text={t("nosignal")} />;
    if (!room.data.ruleset) return <StatusScreen text={t("noRuleset")} />;
    const ruleset = Ruleset.safeParse(room.data.ruleset.manifest);
    if (!ruleset.success) return <StatusScreen text={t("nosignal")} />;

    const types = [...new Set(ruleset.data.creation.flatMap((s) => (s.kind === "choose" ? [s.pick] : [])))];
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
    return <Builder campaignId={p.campaignId} actorId={p.actorId} ruleset={ruleset.data} entries={entries} />;
  } catch {
    return <StatusScreen text={t("nosignal")} />;
  }
}
