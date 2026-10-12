"use client";
import { useRouter } from "next/navigation";

import { UserButton } from "@inconsistable/auth/react";

import { formatBytes, type PackList as PackListData, type RulesetList } from "@/lib/library/library";

import { ImportPanel } from "./components/import-panel/import-panel";
import { PackList } from "./components/pack-list/pack-list";

type LibraryViewProps = { rulesets: RulesetList; packs: PackListData };

// MY RULESETS & PACKS: everything the signed-in user imported. Nothing here is shared; a room can use what its owner
// imported, and a private pack only in rooms its owner runs as GM.
export function LibraryView({ rulesets, packs }: LibraryViewProps) {
  const router = useRouter();
  const { usage } = packs;
  const handleChanged = () => router.refresh();

  return (
    <>
      <header className="band">
        <a href="/">Rooms</a>
        <strong>Rulesets &amp; packs</strong>
        <UserButton />
      </header>
      <main className="page library">
        <ImportPanel onSaved={handleChanged} />

        <section className="stack">
          <h2 className="head">Rulesets</h2>
          {rulesets.length === 0 ? (
            <p className="dim">No rulesets yet. Import one first: a pack is written for a ruleset.</p>
          ) : (
            <ul className="stack library-list">
              {rulesets.map((r) => (
                <li key={r.id} className="card">
                  <strong>{r.slug}</strong>
                  <p className="row small">
                    {r.versions.map((v) => (
                      <span key={v.id} className="chip">
                        {v.version}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="stack">
          <h2 className="head">Packs</h2>
          <p className="small dim">
            {usage.packs} of {usage.maxPacks} packs, {formatBytes(usage.bytes)} of {formatBytes(usage.maxBytes)} stored.
          </p>
          <PackList packs={packs.packs} onChanged={handleChanged} />
        </section>
      </main>
    </>
  );
}
