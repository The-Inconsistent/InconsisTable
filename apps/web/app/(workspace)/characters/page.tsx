import { getTranslations } from "next-intl/server";

import { readLobby } from "@/app/server-api";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { CharactersView } from "@/components/workspace/characters-view/characters-view";

// The characters the device user plays, read with the lobby.
export default async function CharactersPage() {
  const lobby = await readLobby();
  if (!lobby) return <StatusScreen text={(await getTranslations("status"))("nosignal")} />;
  return <CharactersView characters={lobby.characters} />;
}
