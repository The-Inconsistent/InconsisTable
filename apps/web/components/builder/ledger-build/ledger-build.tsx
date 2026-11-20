"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Suspense, use, useCallback, useEffect, useRef, useState } from "react";

import type { Actor, LiveState, Me } from "@inconsistable/core-schema";
import type { BuildCatalogue, Ruleset } from "@inconsistable/rules-engine";

import { DRAFT_DELAY_MS } from "@/components/builder/constants";
import { LedgerBuilder } from "@/components/builder/ledger/ledger-builder";
import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import type { Send } from "@/hooks/use-table/use-table";
import type { LedgerBuild as LedgerBuildDoc } from "@/lib/ledger/ledger";
import { catalogueOf, gmSideOf, roomTier, startingBuild } from "@/lib/ledger/table";

import type { DraftNote } from "./constants";

type LedgerBuildProps = {
  campaignId: string;
  /** A ruleset with a `build` block. */
  ruleset: Ruleset;
  actor: Actor;
  me: Me;
  send: Send;
  campaign: LiveState["campaign"]["fields"];
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
export function LedgerBuild({ campaignId, ruleset, actor, me, send, campaign }: LedgerBuildProps) {
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
            {...{ campaignId, ruleset, actor, me, send, campaign, read }}
            onRetry={() => setRead(readCatalogue(campaignId))}
          />
        </Suspense>
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

type LedgerFormProps = LedgerBuildProps & { catalogue: BuildCatalogue };

function LedgerForm({ campaignId, ruleset, actor, me, send, campaign, catalogue }: LedgerFormProps) {
  const t = useTranslations("ledgerBuilder.table");
  const router = useRouter();
  const tier = roomTier({ ruleset, campaign });
  const gm = gmSideOf({ me, kind: actor.kind });
  const [build, setBuild] = useState(() => startingBuild({ ledger: actor.ledger, tier }));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<DraftNote>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The draft timer: a save still pending when the builder unmounts would fire after the player left.
  useEffect(() => () => clearTimeout(timer.current), []);
  const actorId = actor.id;
  // The build goes as the text JSON.stringify gives, keys in the order they were written (house decision #63).
  const sendDraft = useCallback(
    (next: LedgerBuildDoc) => send({ type: "build.save", actorId, build: JSON.stringify(next), draft: true }),
    [send, actorId],
  );

  // A tap: keeps the next build, and saves it as the draft a moment after the last change.
  const handleChange = useCallback(
    (next: LedgerBuildDoc) => {
      setBuild(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const r = await sendDraft(next);
        setNote(r.ok ? "kept" : "off");
        setError(r.ok ? null : r.error);
      }, DRAFT_DELAY_MS);
    },
    [sendDraft],
  );

  // SAVE CHARACTER: the server resolves the build again and saves only a ready one; back to the table, or its refusal.
  const handleSave = async () => {
    clearTimeout(timer.current);
    setBusy(true);
    const r = await send({ type: "build.save", actorId, build: JSON.stringify(build) });
    setBusy(false);
    if (r.ok) return router.push(`/c/${campaignId}`);
    setError(r.error);
  };

  // SEND TO THE GM / SAVE FOR LATER: the build as it stands, as the draft, now.
  const handleDraft = async () => {
    clearTimeout(timer.current);
    setBusy(true);
    const r = await sendDraft(build);
    setBusy(false);
    setNote(r.ok ? "sent" : "off");
    setError(r.ok ? null : r.error);
  };

  const noteText = {
    idle: "",
    kept: t("kept"),
    sent: gm ? t("savedForLater") : t("sentToGm"),
    off: t("notKept"),
  }[note];
  // The ruleset's `build` is there: the page only opens this builder for a ruleset with one.
  const params = ruleset.build?.params;
  if (!params) return null;
  return (
    <LedgerBuilder
      params={params}
      catalogue={catalogue}
      build={build}
      onChange={handleChange}
      gm={gm}
      tier={tier}
      footer={({ ready }) => (
        <>
          <button type="button" className="btn primary" disabled={busy || !ready} onClick={handleSave}>
            {t("save")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={handleDraft}>
            {gm ? t("saveForLater") : t("sendToGm")}
          </button>
          <span className="small dim" role="status">
            {noteText}
          </span>
          {error && (
            <p className="error lb-refusal" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    />
  );
}
