import { getTranslations } from "next-intl/server";

import { apiGet, readLobby } from "@/app/server-api";
import { LibraryView } from "@/components/library/library-view/library-view";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { PackList, RulesetList, WorldList } from "@/lib/library/library";

// The device user's imported rulesets, packs and Worlds. The lists are read on the server; the page then refreshes after
// every import or delete. The lobby (already read by the workspace rail) says whether the caller may import.
export default async function LibraryPage() {
  try {
    const [rulesets, packs, worlds, lobby] = await Promise.all([
      apiGet("/api/rulesets"),
      apiGet("/api/packs"),
      apiGet("/api/worlds"),
      readLobby(),
    ]);
    const rulesetList = RulesetList.safeParse(rulesets.ok ? await rulesets.json() : null);
    const packList = PackList.safeParse(packs.ok ? await packs.json() : null);
    const worldList = WorldList.safeParse(worlds.ok ? await worlds.json() : null);
    if (rulesetList.success && packList.success && worldList.success)
      return (
        <LibraryView
          rulesets={rulesetList.data}
          packs={packList.data}
          worlds={worldList.data}
          canImport={lobby?.canCreate ?? false}
        />
      );
  } catch {
    // falls through to the same message as an answer we can't read
  }
  return <StatusScreen text={(await getTranslations("status"))("nosignal")} />;
}
