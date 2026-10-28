import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { JOIN_ERRORS, type JoinError } from "@/app/constants";
import { apiGet, readLobby } from "@/app/server-api";
import { LobbyView } from "@/components/lobby/lobby-view/lobby-view";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { AuthMe, CampaignRef } from "@/lib/api-reply/api-reply";
import { RulesetList } from "@/lib/library/library";

type HomeProps = { searchParams: Promise<{ join?: string | string[]; signin?: string | string[] }> };

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

const SIGNED_OUT: AuthMe = { signInEnabled: false, name: null, account: null };

// Whether this deployment signs in, and who the caller is to it. Without an answer the lobby shows no account bar.
async function authMe(): Promise<AuthMe> {
  try {
    const res = await apiGet("/api/auth/me");
    const parsed = AuthMe.safeParse(res.ok ? await res.json() : null);
    return parsed.success ? parsed.data : SIGNED_OUT;
  } catch {
    return SIGNED_OUT;
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
  const { join, signin } = await searchParams;
  if (isJoinError(join)) return <StatusScreen text={t(`status.${join}`)} />;

  const lobby = await readLobby();
  if (!lobby) return <StatusScreen text={t("status.nosignal")} />;
  if (!lobby.mine.length && !lobby.seated.length && !lobby.archived.length) {
    const table = await guestTable();
    if (table) redirect(`/c/${table}`);
  }
  const [rulesets, me] = await Promise.all([lobby.canCreate ? importedRulesets() : [], authMe()]);
  return <LobbyView lobby={lobby} rulesets={rulesets} me={me} signInFailed={signin === "failed"} />;
}
