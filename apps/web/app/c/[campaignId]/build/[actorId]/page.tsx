import { Ruleset } from "@inconsistable/rules-engine";

import { JOIN_ERRORS, NO_ACCESS } from "@/app/constants";
import { apiGet } from "@/app/server-api";
import { Builder } from "@/components/builder/builder";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { RulesReply, type RulesEntry } from "@/lib/library/library";

type BuildProps = { params: Promise<{ campaignId: string; actorId: string }> };

const MAX_PICKS = 500;

// BUILD CHARACTER for one actor. The ruleset and the entries a step may pick are read here, on the server, through the
// seat-scoped rules route (a player is never sent a GM-only entry); the form then runs on the client.
export default async function Build({ params }: BuildProps) {
  const p = await params;
  const campaignId = encodeURIComponent(p.campaignId);
  try {
    const res = await apiGet(`/api/campaigns/${campaignId}/rules?limit=1`);
    if (res.status === 400 || res.status === 401 || res.status === 403) return <StatusScreen text={NO_ACCESS} />;
    const room = RulesReply.safeParse(res.ok ? await res.json() : null);
    if (!room.success) return <StatusScreen text={JOIN_ERRORS.nosignal} />;
    if (!room.data.ruleset) return <StatusScreen text="The GM hasn't picked a ruleset yet." />;
    const ruleset = Ruleset.safeParse(room.data.ruleset.manifest);
    if (!ruleset.success) return <StatusScreen text={JOIN_ERRORS.nosignal} />;

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
      if (!reply.success) return <StatusScreen text={JOIN_ERRORS.nosignal} />;
      entries[type] = reply.data.entries;
    }
    return <Builder campaignId={p.campaignId} actorId={p.actorId} ruleset={ruleset.data} entries={entries} />;
  } catch {
    return <StatusScreen text={JOIN_ERRORS.nosignal} />;
  }
}
