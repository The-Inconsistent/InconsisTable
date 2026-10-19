import { useTranslations } from "next-intl";

import type { LobbyCharacter } from "@inconsistable/core-schema";

import { PageHead } from "@/components/ui/page-head/page-head";

type CharactersViewProps = { characters: LobbyCharacter[] };

// MY CHARACTERS: every character a seat of yours holds, grouped by the room it lives in. A card opens that room.
// ponytail: only characters held in rooms, upgrade: the character library outside campaigns (docs/design.md §3.2)
export function CharactersView({ characters }: CharactersViewProps) {
  const t = useTranslations("workspace");
  const rooms = new Map<string, LobbyCharacter[]>();
  for (const c of characters) rooms.set(c.campaignId, [...(rooms.get(c.campaignId) ?? []), c]);

  return (
    <main className="page">
      <PageHead title={t("page.characters")} lede={t("lede.characters")} />
      {rooms.size === 0 && <p className="dim">{t("noCharacters")}</p>}
      {[...rooms].map(([campaignId, held]) => (
        <section key={campaignId} className="stack">
          <h2 className="head">
            {held[0]?.campaignName} <span className="ws-tally">{held.length}</span>
          </h2>
          <div className="grid">
            {held.map((c) => (
              <a key={c.id} className="card ws-tile" href={`/c/${campaignId}`}>
                <strong className="card-name">{c.name}</strong>
                <span className="row small">
                  <span className="chip">{t(`kind.${c.kind}`)}</span>
                  {c.status !== "active" && (
                    <span className="chip" data-status={c.status}>
                      {t(`status.${c.status}`)}
                    </span>
                  )}
                </span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
