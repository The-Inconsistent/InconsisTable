import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { JOIN_ERRORS, type JoinError } from "@/app/constants";
import { apiGet, readLobby } from "@/app/server-api";
import { LobbyView } from "@/components/lobby/lobby-view/lobby-view";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { CampaignRef } from "@/lib/api-reply/api-reply";
import { RulesetList } from "@/lib/library/library";

type HomeProps = { searchParams: Promise<{ join?: string | string[] }> };

const isJoinError = (v: unknown): v is JoinError =>
  typeof v === "string" && (JOIN_ERRORS as readonly string[]).includes(v);

// A returning guest's table (from their QR cookie), if they have one.
async function guestTable(): Promise<string | null> {
  try {
    const res = await apiGet("/api/guest");
    const parsed = CampaignRef.safeParse(res.ok ? await res.json() : null);
    return parsed.success ? parsed.data.campaignId : null;
  } catch {
    return null;
  }
}

// The rulesets the caller imported, for the picker in NEW ROOM. Without them the room is made without one.
async function importedRulesets(): Promise<RulesetList> {
  try {
    const res = await apiGet("/api/rulesets");
    const parsed = RulesetList.safeParse(res.ok ? await res.json() : null);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

// The lobby of this device's user. A device with no rooms of its own that holds a guest QR seat goes back to that table.
export default async function Home({ searchParams }: HomeProps) {
  const t = await getTranslations();
  const { join } = await searchParams;
  if (isJoinError(join)) return <StatusScreen text={t(`status.${join}`)} />;

  const lobby = await readLobby();
  if (!lobby) return <StatusScreen text={t("status.nosignal")} />;
  if (!lobby.mine.length && !lobby.seated.length && !lobby.archived.length) {
    const table = await guestTable();
    if (table) redirect(`/c/${table}`);
  }
  return <LobbyView lobby={lobby} rulesets={lobby.canCreate ? await importedRulesets() : []} />;
}
