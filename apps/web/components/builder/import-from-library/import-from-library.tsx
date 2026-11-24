"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { BuildCatalogue, BuildParams } from "@inconsistable/rules-engine";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import {
  buildOf,
  listLibrary,
  notHere,
  readCharacter,
  type LibraryEntry,
  type NotHere,
} from "@/lib/character-library/character-library";
import type { LedgerBuild } from "@/lib/ledger/ledger";

type ImportFromLibraryProps = {
  room: { slug: string; version: string; packs: readonly string[]; tier: number };
  params: BuildParams;
  catalogue: BuildCatalogue;
  /** The picked character's build, kept as this seat's draft and put in the builder's place. */
  onLoad: (build: LedgerBuild) => Promise<{ ok: true } | { ok: false; error: string }>;
};

// IMPORT FROM LIBRARY (house decision #104): the user's library characters, each one this room cannot take shown with
// why; the one picked becomes this seat's draft through the room's own build.save. The library's copy stays as it is.
export function ImportFromLibrary({ room, params, catalogue, onLoad }: ImportFromLibraryProps) {
  const t = useTranslations("characterLibrary.import");
  const tr = useRefusal();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<{ entry: LibraryEntry; refused: NotHere | null }[] | null>(null);

  // IMPORT FROM LIBRARY: the list, each character read whole to say whether it can come.
  const handleOpen = async () => {
    setOpen(true);
    setBusy(true);
    setError(null);
    const cards = await listLibrary();
    if (!cards.ok) {
      setBusy(false);
      return setError(cards.error ? tr(cards.error) : t("failed"));
    }
    const read = await Promise.all(cards.value.map((c) => readCharacter(c.id)));
    setList(
      read.flatMap((r) =>
        r.ok ? [{ entry: r.value, refused: notHere({ entry: r.value, room, params, catalogue }) }] : [],
      ),
    );
    setBusy(false);
  };
  // USE THIS ONE: its build in the builder's place.
  const handlePick = async (entry: LibraryEntry) => {
    const build = buildOf(entry);
    if (!build) return setError(t("unreadable"));
    setBusy(true);
    const r = await onLoad(build);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
  };
  const reason = (r: NotHere) =>
    r.why === "notDone"
      ? t("notDone")
      : r.why === "otherGame"
        ? t("otherGame", { slug: r.slug })
        : r.why === "missingPack"
          ? t("missingPack", { slug: r.slug })
          : r.why === "otherTier"
            ? t("otherTier", { tier: r.tier })
            : t("otherVersion", { version: r.version, detail: r.detail });

  if (!open)
    return (
      <div className="row">
        <button type="button" className="btn" onClick={handleOpen}>
          {t("open")}
        </button>
      </div>
    );
  return (
    <section id="import-from-library" className="card stack" aria-busy={busy}>
      <h2 className="head">{t("title")}</h2>
      <p className="small dim">{t("lede")}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {list?.length === 0 && <p className="dim">{t("empty")}</p>}
      {list && list.length > 0 && (
        <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {list.map(({ entry, refused }) => (
            <li key={entry.id} className="row between" style={{ flexWrap: "wrap" }}>
              <span>
                <strong>{entry.name || t("unnamed")}</strong>{" "}
                <span className="small dim">
                  {entry.ruleset.slug} {entry.ruleset.version}
                </span>
                {refused && <span className="small"> · {reason(refused)}</span>}
              </span>
              <button
                type="button"
                className="btn"
                disabled={refused !== null || busy}
                onClick={() => void handlePick(entry)}
              >
                {t("use")}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" style={{ justifySelf: "start" }} onClick={() => setOpen(false)}>
        {t("close")}
      </button>
    </section>
  );
}
