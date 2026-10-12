import { Me } from "@inconsistable/core-schema";

import { JOIN_ERRORS, NO_ACCESS } from "@/app/constants";
import { apiGet } from "@/app/server-api";
import { asGmTab, TAB_PARAM } from "@/components/gm/gm-app/constants";
import { GmApp } from "@/components/gm/gm-app/gm-app";
import { PlayerApp } from "@/components/player/player-app/player-app";
import { TableScreen } from "@/components/screen/table-screen/table-screen";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";

type TableProps = {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// One table: the GM app (GM, co-GM, or an admin who opened it), the player app, or the table screen, by the caller's
// seat. The api decides what each seat may do; the app only hides what it can't.
export default async function Table({ params, searchParams }: TableProps) {
  const [p, query] = await Promise.all([params, searchParams]);
  const campaignId = encodeURIComponent(p.campaignId);
  let me: Me;
  try {
    const res = await apiGet(`/api/campaigns/${campaignId}/me`);
    if (res.status === 400 || res.status === 401) return <StatusScreen text={NO_ACCESS} />;
    const parsed = Me.safeParse(res.ok ? await res.json() : null);
    if (!parsed.success) return <StatusScreen text={JOIN_ERRORS.nosignal} />;
    me = parsed.data;
  } catch {
    return <StatusScreen text={JOIN_ERRORS.nosignal} />;
  }

  const seat = me.seat;
  if (seat.kind === "admin" || (seat.kind === "member" && seat.role !== "player"))
    return <GmApp me={me} initialTab={asGmTab(query[TAB_PARAM])} />;
  if (seat.kind === "token" && seat.role === "screen") return <TableScreen campaignId={me.campaignId} />;
  if (!seat.characterIds.length) return <StatusScreen text="No character yet. Ask your GM." />;
  return <PlayerApp me={me} />;
}
