import { getTranslations } from "next-intl/server";

import { Ruleset } from "@inconsistable/rules-engine";

import { apiGet } from "@/app/server-api";
import { LibraryBuild } from "@/components/builder/library-build/library-build";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { LibraryEntry } from "@/lib/character-library/character-library";

type LibraryCharacterProps = { params: Promise<{ characterId: string }> };

// A library character outside any room (house decision #104): read on the server with its ruleset and catalogue when
// they are all the user's own, then built on the client by the room's own builder with a library save in place of the
// socket. One whose ruleset or packs belong to someone else is shown, and edited in a room.
export default async function LibraryCharacter({ params }: LibraryCharacterProps) {
  const [{ characterId }, t] = await Promise.all([params, getTranslations()]);
  const id = encodeURIComponent(characterId);
  try {
    const res = await apiGet(`/api/library/${id}`);
    if (res.status === 404) return <StatusScreen text={t("characterLibrary.notFound")} />;
    if (res.status === 401 || res.status === 403) return <StatusScreen text={t("characterLibrary.needsAccount")} />;
    const entry = LibraryEntry.safeParse(res.ok ? await res.json() : null);
    if (!entry.success) return <StatusScreen text={t("status.nosignal")} />;
    if (!entry.data.editable) return <LibraryBuild entry={entry.data} ruleset={null} catalogue={null} />;
    const rules = await apiGet(`/api/library/${id}/rules`);
    const body: unknown = rules.ok ? await rules.json() : null;
    const manifest = Ruleset.safeParse((body as { manifest?: unknown } | null)?.manifest);
    if (!manifest.success) return <StatusScreen text={t("status.nosignal")} />;
    // The catalogue goes to the client as the api sent it: the client reads it as the room's builder does.
    return <LibraryBuild entry={entry.data} ruleset={manifest.data} catalogue={body} />;
  } catch {
    return <StatusScreen text={t("status.nosignal")} />;
  }
}
