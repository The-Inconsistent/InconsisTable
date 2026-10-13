import { redirect } from "next/navigation";

import { signedInUserId } from "@inconsistable/auth/next";
import { Lobby } from "@inconsistable/core-schema";

import { JOIN_ERRORS, type JoinError } from "@/app/constants";
import { apiGet } from "@/app/server-api";
import { LobbyView } from "@/components/lobby/lobby-view/lobby-view";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { CampaignRef } from "@/lib/api-reply/api-reply";
import { RulesetList } from "@/lib/library/library";

type HomeProps = { searchParams: Promise<{ join?: string | string[] }> };

const isJoinError = (v: unknown): v is JoinError => typeof v === "string" && Object.hasOwn(JOIN_ERRORS, v);

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

// The lobby for signed-in users; guests go back to their table; everyone else is asked to sign in.
export default async function Home({ searchParams }: HomeProps) {
  const { join } = await searchParams;
  if (isJoinError(join)) return <StatusScreen text={JOIN_ERRORS[join]} />;

  const userId = await signedInUserId();
  if (!userId) {
    const table = await guestTable();
    if (table) redirect(`/c/${table}`);
    return (
      <main className="center">
        <div className="stack" style={{ justifyItems: "center", textAlign: "center" }}>
          <h1 className="title">InconsisTable</h1>
          <p className="dim">A table companion for in-person tabletop RPGs.</p>
          <a className="btn primary" href="/sign-in">
            Sign in
          </a>
          <p className="dim small">Joining as a guest? Scan the QR code on the GM&apos;s tablet.</p>
        </div>
      </main>
    );
  }

  let lobby: Lobby;
  try {
    const res = await apiGet("/api/lobby");
    const parsed = Lobby.safeParse(res.ok ? await res.json() : null);
    if (!parsed.success) return <StatusScreen text={JOIN_ERRORS.nosignal} />;
    lobby = parsed.data;
  } catch {
    return <StatusScreen text={JOIN_ERRORS.nosignal} />;
  }
  return <LobbyView lobby={lobby} rulesets={lobby.canCreate ? await importedRulesets() : []} />;
}
