"use client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";

import { PageHead } from "@/components/ui/page-head/page-head";
import { formatBytes, type PackList as PackListData, type RulesetList } from "@/lib/library/library";

import { ImportPanel } from "./components/import-panel/import-panel";
import { PackList } from "./components/pack-list/pack-list";

type LibraryViewProps = { rulesets: RulesetList; packs: PackListData };

// MY RULESETS & PACKS: everything the device's user imported. Nothing here is shared; a room can use what its owner
// imported, and a private pack only in rooms its owner runs as GM.
export function LibraryView({ rulesets, packs }: LibraryViewProps) {
  const t = useTranslations("library");
  const tWs = useTranslations("workspace");
  const locale = useLocale();
  const router = useRouter();
  const { usage } = packs;
  const [importing, setImporting] = useState(rulesets.length === 0);
  const [toggled, setToggled] = useState(false);

  // IMPORT in the head: shows or folds the importer, and moves the cursor into it when it opens.
  const handleToggle = () => {
    setImporting(!importing);
    setToggled(true);
  };
  const handleChanged = () => router.refresh();

  return (
    <main className="page library">
      <PageHead title={t("title")} lede={tWs("lede.library")}>
        <button
          type="button"
          className="btn primary"
          aria-expanded={importing}
          aria-controls="import-panel"
          onClick={handleToggle}
        >
          {tWs("importToggle")}
        </button>
      </PageHead>
      {importing && <ImportPanel onSaved={handleChanged} autoFocus={toggled} />}

      <section className="stack">
        <h2 className="head">
          {t("rulesets")} <span className="ws-tally">{rulesets.length}</span>
        </h2>
        {rulesets.length === 0 ? (
          <p className="dim">{t("noRulesets")}</p>
        ) : (
          <ul className="grid library-list rise-list">
            {rulesets.map((r, i) => (
              <li key={r.id} className="card" style={{ "--i": i } as CSSProperties}>
                <strong className="card-name">{r.slug}</strong>
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
        <h2 className="head">
          {t("packs")} <span className="ws-tally">{packs.packs.length}</span>
        </h2>
        <p className="small dim">
          {t("usage", {
            packs: usage.packs,
            maxPacks: usage.maxPacks,
            bytes: formatBytes(usage.bytes, locale),
            maxBytes: formatBytes(usage.maxBytes, locale),
          })}
        </p>
        <PackList packs={packs.packs} onChanged={handleChanged} />
      </section>
    </main>
  );
}
