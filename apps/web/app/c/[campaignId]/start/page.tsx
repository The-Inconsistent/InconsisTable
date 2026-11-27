import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { Me } from "@inconsistable/core-schema";
import { localRuleset } from "@inconsistable/rules-engine";

import { apiGet } from "@/app/server-api";
import { FirstRun } from "@/components/gm/first-run/first-run";
import { RoomWorld } from "@/components/ui/room-world/room-world";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { RulesReply } from "@/lib/library/library";

type StartProps = { params: Promise<{ campaignId: string }> };

// The room's first-run walk (house decision #146), right after the campaign wizard: the setup checklist its ruleset
// declares, one step at a time. Only the one who runs the room walks it; anyone else goes to the room itself.
export default async function Start({ params }: StartProps) {
  const [p, t] = await Promise.all([params, getTranslations("status")]);
  const campaignId = encodeURIComponent(p.campaignId);
  let me: Me;
  let rules: RulesReply;
  try {
    const [meRes, rulesRes] = await Promise.all([
      apiGet(`/api/campaigns/${campaignId}/me`),
      apiGet(`/api/campaigns/${campaignId}/rules?limit=1`),
    ]);
    if (meRes.status === 400 || meRes.status === 401) return <StatusScreen text={t("noAccess")} />;
    const parsedMe = Me.safeParse(meRes.ok ? await meRes.json() : null);
    const parsedRules = RulesReply.safeParse(rulesRes.ok ? await rulesRes.json() : null);
    if (!parsedMe.success || !parsedRules.success) return <StatusScreen text={t("nosignal")} />;
    me = parsedMe.data;
    rules = parsedRules.data;
  } catch {
    return <StatusScreen text={t("nosignal")} />;
  }
  const seat = me.seat;
  const runs =
    (seat.kind === "member" && seat.role !== "player") ||
    (me.tableMode !== "gm" && me.userId !== null && me.userId === me.campaignOwnerId);
  if (!runs) redirect(`/c/${campaignId}`);
  const ruleset = localRuleset(rules.ruleset?.manifest, await getLocale());
  return (
    <RoomWorld world={rules.world} ruleset={ruleset}>
      <FirstRun me={me} ruleset={ruleset} packs={rules.packs} />
    </RoomWorld>
  );
}
