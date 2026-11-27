"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";

import type { Ruleset } from "@inconsistable/rules-engine";

import { LedgerForm, type SaveBuild } from "@/components/builder/ledger-form/ledger-form";
import { PageHead } from "@/components/ui/page-head/page-head";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { buildOf, saveCharacter, type LibraryEntry } from "@/lib/character-library/character-library";
import { catalogueOf } from "@/lib/ledger/table";
import { afterSave, forgetLocal, keepLocal, newerLocal, readLocal, sameBuild } from "@/lib/library-draft/library-draft";

type LibraryBuildProps = {
  entry: LibraryEntry;
  /** The character's ruleset and the catalogue of its packs, as the api answered them; null when they are not the
   * user's own, and the character is edited in a room. */
  ruleset: Ruleset | null;
  catalogue: unknown;
};

const NAME_DELAY_MS = 800;

const subscribeNothing = () => () => {};

// A library character outside any room (house decision #104): its name, and the room's own builder with a library
// save in place of the socket. Every save carries the revision it read, so two tabs never overwrite each other: the
// saves of this page go one after another, each with the revision the last one answered. Every change is also kept in
// this browser at once (house decision #188): opened again, the page starts from that copy when the server has not
// saved since it was made, so a tab closed inside the autosave second loses nothing; otherwise the server's wins.
export function LibraryBuild({ entry, ruleset, catalogue }: LibraryBuildProps) {
  const t = useTranslations("characterLibrary.builder");
  const tr = useRefusal();
  const format = useFormatter();
  const router = useRouter();
  const rev = useRef(entry.rev);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const nameTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [name, setName] = useState(entry.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const read = useMemo(() => catalogueOf(catalogue), [catalogue]);
  const params = ruleset?.build?.params;
  // This browser's copy of the draft, read once (none on the server, where the builder is not drawn).
  const [local] = useState(() =>
    newerLocal({ stored: readLocal({ userId: entry.userId, id: entry.id }), rev: entry.rev }),
  );
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const restored = local !== null && !sameBuild(local, entry.build);

  // One save after another, each at the revision the last answered.
  const patch = useCallback(
    (body: { name?: string; build?: string; done?: boolean }) => {
      const run = queue.current.then(async () => {
        const r = await saveCharacter(entry.id, { rev: rev.current, ...body });
        if (r.ok) rev.current = r.value.rev;
        // The server holds this build now: a done one forgets the browser's copy, a draft's goes once it is the same.
        if (r.ok && body.build !== undefined && body.done) forgetLocal(entry.id);
        else if (r.ok && body.build !== undefined)
          afterSave({ userId: entry.userId, id: entry.id, rev: r.value.rev, build: body.build });
        return r;
      });
      queue.current = run.catch(() => undefined);
      return run;
    },
    [entry.id, entry.userId],
  );
  const save = useCallback<SaveBuild>(
    async (text, draft) => {
      const r = await patch({ build: text, done: !draft });
      return r.ok ? { ok: true } : { ok: false, error: r.error ? tr(r.error) : t("failed") };
    },
    [patch, tr, t],
  );
  // Every change of the build, kept in this browser over the revision the server last answered.
  const handleLocal = useCallback(
    (text: string) => keepLocal({ userId: entry.userId, id: entry.id, rev: rev.current, build: text }),
    [entry.id, entry.userId],
  );
  // NAME: kept a moment after the last key.
  const handleName = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setName(next);
    clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(async () => {
      const r = await patch({ name: next.trim() });
      setNameError(r.ok ? null : r.error ? tr(r.error) : t("failed"));
    }, NAME_DELAY_MS);
  };

  const head = (
    <PageHead
      title={name.trim() || t("unnamed")}
      lede={t("lede", {
        ruleset: `${entry.ruleset.title ?? entry.ruleset.slug} ${entry.ruleset.version}`,
        when: format.dateTime(new Date(entry.updatedAt), { dateStyle: "medium", timeStyle: "short" }),
      })}
    />
  );
  return (
    <main className="page lb-page stack">
      <Link href="/">{t("back")}</Link>
      {head}
      <label className="stack" style={{ maxWidth: 480 }}>
        {t("name")}
        <input value={name} onChange={handleName} maxLength={80} />
      </label>
      {nameError && (
        <p className="error" role="alert">
          {nameError}
        </p>
      )}
      {!ruleset || !params || !read ? (
        <p className="card">{entry.editable ? t("unreadable") : t("inARoom")}</p>
      ) : (
        hydrated && (
          <>
            {restored && (
              <p className="small" role="status">
                {t("restored")}
              </p>
            )}
            <LedgerForm
              params={params}
              catalogue={read}
              initial={buildOf({ build: local }) ?? buildOf(entry) ?? { tier: params.tiers.min }}
              onDraft={handleLocal}
              gm
              save={save}
              onSaved={() => router.push("/")}
              draftLabel={t("keep")}
              sentNote={t("kept")}
            />
          </>
        )
      )}
    </main>
  );
}
