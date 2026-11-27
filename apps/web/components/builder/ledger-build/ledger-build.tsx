"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Suspense, use, useCallback, useMemo, useState } from "react";

import type { Actor, LiveState, Me } from "@inconsistable/core-schema";
import type { BuildCatalogue, Ruleset } from "@inconsistable/rules-engine";

import { ImportFromLibrary } from "@/components/builder/import-from-library/import-from-library";
import { LedgerForm as SharedForm, type SaveBuild } from "@/components/builder/ledger-form/ledger-form";
import { ActorPictureField } from "@/components/ui/actor-picture-field/actor-picture-field";
import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import type { Send } from "@/hooks/use-table/use-table";
import type { LedgerBuild as LedgerBuildDoc } from "@/lib/ledger/ledger";
import { catalogueOf, gmSideOf, playOf, roomTier, startingBuild } from "@/lib/ledger/table";

import { LedgerOverrides } from "./components/ledger-overrides/ledger-overrides";
import { SaveToLibrary } from "./components/save-to-library/save-to-library";

type LedgerBuildProps = {
  campaignId: string;
  /** A ruleset with a `build` block. */
  ruleset: Ruleset;
  actor: Actor;
  me: Me;
  send: Send;
  campaign: LiveState["campaign"]["fields"];
  /** The step a link asked for, for a character in play. */
  step?: string | null | undefined;
  /** The slugs of the packs the room is served, for IMPORT FROM LIBRARY to refuse a character made with another. */
  packs: readonly string[];
};

// One read of the room's catalogue. Never rejects: a failed read is null, which the screen shows with a retry.
async function readCatalogue(campaignId: string): Promise<BuildCatalogue | null> {
  try {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/catalogue`, { cache: "no-store" });
    const reply: unknown = res.ok ? await res.json() : null;
    return catalogueOf(reply);
  } catch {
    return null;
  }
}

// BUILD CHARACTER with the ledger builder (docs/adr/0011, house decision #63): the room's catalogue read by the
// browser, the build started from the draft or the saved build, saved through `build.save`, and kept as a draft the
// GM can open a moment after every change.
export function LedgerBuild({ campaignId, ruleset, actor, me, send, campaign, step, packs }: LedgerBuildProps) {
  const t = useTranslations("builder");
  // The read is held here, outside the Suspense boundary, so it is started once; a retry starts another.
  const [read, setRead] = useState(() => readCatalogue(campaignId));
  return (
    <>
      <header className="band">
        <a href={`/c/${campaignId}`}>{t("backLink")}</a>
        <strong>{t("buildTitle", { name: actor.name })}</strong>
        <LocaleSwitch />
        <ThemeSwitch />
      </header>
      <main className="page lb-page">
        <Suspense fallback={<Loading />}>
          <Loaded
            {...{ campaignId, ruleset, actor, me, send, campaign, read, step, packs }}
            onRetry={() => setRead(readCatalogue(campaignId))}
          />
        </Suspense>
        {gmSideOf({ me, kind: actor.kind }) && <LedgerOverrides ruleset={ruleset} actor={actor} send={send} />}
        {me.seat.kind === "member" && me.seat.characterIds.includes(actor.id) && actor.ledger?.build && (
          <SaveToLibrary campaignId={campaignId} actorId={actor.id} />
        )}
      </main>
    </>
  );
}

function Loading() {
  const t = useTranslations("ledgerBuilder.table");
  return (
    <p className="status" role="status">
      {t("loading")}
    </p>
  );
}

type LoadedProps = LedgerBuildProps & { read: Promise<BuildCatalogue | null>; onRetry: () => void };

// The catalogue once read, or what went wrong with a way to try again.
function Loaded({ read, onRetry, ...rest }: LoadedProps) {
  const t = useTranslations("ledgerBuilder.table");
  const catalogue = use(read);
  if (!catalogue)
    return (
      <section className="card stack">
        <p className="error" role="alert">
          {t("failed")}
        </p>
        <button type="button" className="btn" onClick={onRetry} style={{ justifySelf: "start" }}>
          {t("retry")}
        </button>
      </section>
    );
  return <LedgerForm {...rest} catalogue={catalogue} />;
}

type RoomFormProps = LedgerBuildProps & { catalogue: BuildCatalogue };

// The room's side of the builder: the build saved through `build.save` on the socket, the room's Tier, a made
// character's play, and back to the table after a save; IMPORT FROM LIBRARY above it for the seat building its own.
function LedgerForm({ campaignId, ruleset, actor, me, send, campaign, catalogue, step, packs }: RoomFormProps) {
  const t = useTranslations("ledgerBuilder.table");
  const router = useRouter();
  const tier = roomTier({ ruleset, campaign });
  const gm = gmSideOf({ me, kind: actor.kind });
  // What the builder starts from; a character brought from the library starts it again from that one (`n` remounts it).
  const [seed, setSeed] = useState(() => ({ n: 0, initial: startingBuild({ ledger: actor.ledger, tier }) }));
  // A made character is in play (house decision #64): the builder prices purchases against the XP it earned.
  const play = useMemo(() => playOf({ ruleset, actor, campaign }), [ruleset, actor, campaign]);
  const actorId = actor.id;
  const save = useCallback<SaveBuild>(
    async (text, draft) => {
      // The GM side's first save over a sheet made by hand keeps what the ruleset marks (house decisions #96, #199);
      // the api reads keepSheet only for such a sheet.
      const r = await send({ type: "build.save", actorId, build: text, draft, keepSheet: gm && !draft });
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    },
    [send, actorId, gm],
  );
  // The ruleset's `build` is there: the page only opens this builder for a ruleset with one.
  const params = ruleset.build?.params;
  if (!params) return null;
  // IMPORT FROM LIBRARY: the copy kept as this seat's draft through the room's own build.save, then built from.
  const handleLoad = async (next: LedgerBuildDoc) => {
    const r = await save(JSON.stringify(next), true);
    if (r.ok) setSeed((was) => ({ n: was.n + 1, initial: next }));
    return r;
  };
  return (
    <>
      {/* A character not made yet can come from the library; one in play is the room's own. */}
      {!actor.ledger?.build && (
        <ImportFromLibrary
          room={{ slug: ruleset.id, version: ruleset.version, packs, tier }}
          params={params}
          catalogue={catalogue}
          onLoad={handleLoad}
        />
      )}
      <SharedForm
        key={seed.n}
        {...{ params, catalogue, tier, play, gm, step, save }}
        initial={seed.initial}
        onSaved={() => router.push(`/c/${campaignId}`)}
        lastStep={<ActorPictureField campaignId={campaignId} actor={actor} send={send} className="stack" />}
        draftLabel={gm ? t("saveForLater") : t("sendToGm")}
        sentNote={gm ? t("savedForLater") : t("sentToGm")}
      />
    </>
  );
}
