"use client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { UserButton } from "@inconsistable/auth/react";

import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import { formatBytes, type PackList as PackListData, type RulesetList } from "@/lib/library/library";

import { ImportPanel } from "./components/import-panel/import-panel";
import { PackList } from "./components/pack-list/pack-list";

type LibraryViewProps = { rulesets: RulesetList; packs: PackListData };

// MY RULESETS & PACKS: everything the signed-in user imported. Nothing here is shared; a room can use what its owner
// imported, and a private pack only in rooms its owner runs as GM.
export function LibraryView({ rulesets, packs }: LibraryViewProps) {
  const t = useTranslations("library");
  const locale = useLocale();
  const router = useRouter();
  const { usage } = packs;
  const handleChanged = () => router.refresh();

  return (
    <>
      <header className="band">
        <a href="/">{t("campaigns")}</a>
        <strong>{t("title")}</strong>
        <span className="row">
          <LocaleSwitch />
          <ThemeSwitch />
          <UserButton />
        </span>
      </header>
      <main className="page library">
        <ImportPanel onSaved={handleChanged} />

        <section className="stack">
          <h2 className="head">{t("rulesets")}</h2>
          {rulesets.length === 0 ? (
            <p className="dim">{t("noRulesets")}</p>
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
          <h2 className="head">{t("packs")}</h2>
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
    </>
  );
}
