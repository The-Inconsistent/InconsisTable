"use client";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";

import {
  canActOnMember,
  canInCampaign,
  gmPermOf,
  type ActionInput,
  type Actor,
  type BookSource,
  type CodexEntry,
  type LiveState,
  type Me,
} from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { CharacterDrawer } from "@/components/gm/party/components/character-drawer/character-drawer";
import { SeatTab } from "@/components/gm/party/components/character-drawer/components/seat-tab/seat-tab";
import { StatusTab } from "@/components/gm/party/components/character-drawer/components/status-tab/status-tab";
import { MorePanel } from "@/components/gm/party/components/more-panel/more-panel";
import { PartyCard } from "@/components/gm/party/components/party-card/party-card";
import { SessionBand } from "@/components/gm/party/components/session-band/session-band";
import { WhisperPanel } from "@/components/gm/whisper-button/components/whisper-panel/whisper-panel";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { DraftRecap, RequestPage, Send } from "@/hooks/use-table/use-table";
import { needsBuild } from "@/lib/builder/builder";
import { anchorId } from "@/lib/checklist/checklist";
import { gmEntryOf, gmSideOf, usesLedger, xpFiguresOf } from "@/lib/ledger/table";
import { isSeated, objectivesOf, partyCardOf } from "@/lib/party-card/party-card";
import { qrImage } from "@/lib/qr/qr";
import { restsOf } from "@/lib/sheet/sheet";
import { shareOrigin } from "@/lib/share-origin/share-origin";

type PartyProps = {
  me: Me;
  state: LiveState;
  send: Send;
  draftRecap: DraftRecap;
  /** What a character sheet needs: the ruleset as the GM reads it, the served books and the page relay. */
  sheet: { ruleset: Ruleset | null; books: readonly BookSource[]; requestPage: RequestPage };
  /** The room's codex entries as this seat holds them: a character's objectives are the quests listed to it. */
  entries?: readonly CodexEntry[];
  /** A quick game just made this room: the player invite QR is up on arrival. */
  autoQr?: boolean;
  /** The host's setup pieces (the setup checklist, how the table sits), drawn first under MORE. */
  setup?: ReactNode;
};

// A link the phones open, shown as a QR and as text to copy.
type Shown = { title: string; url: string; qr: string };

// PARTY (docs/design.md §3.6, §3.7; house decision #222, as Auspex's): the session band, the seated characters as
// cards, those in reserve folded below; a card opens the character's drawer. Everything else waits under MORE.
export function Party({ me, state, send, draftRecap, sheet, entries, autoQr = false, setup }: PartyProps) {
  const t = useTranslations("party");
  const tWhisper = useTranslations("whisper");
  const tRest = useTranslations("rest");
  const tRoles = useTranslations("roles");
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null); // the character whose drawer is open
  const [whisperTo, setWhisperTo] = useState<string | null>(null);
  const can = (perm: Parameters<typeof canInCampaign>[0]["perm"]) => canInCampaign({ ctx: me, perm });
  const ruleset = sheet.ruleset;
  const compiled = useMemo(() => {
    const c = ruleset ? compileRuleset(ruleset) : null;
    return c?.ok ? c.compiled : null;
  }, [ruleset]);
  const builds = (ruleset?.creation.length ?? 0) > 0;
  // Whispers need a GM (house decision #93) and go from the side that runs the session, as the header's WHISPER.
  const whispers =
    state.campaign.tableMode === "gm" && canInCampaign({ ctx: { ...me, tableMode: "gm" }, perm: "session:run" });
  const pcs = state.actors.filter((a) => a.kind === "pc");
  const active = pcs.filter((a) => a.status === "active" && isSeated({ access: state.access, actorId: a.id }));
  const reserve = pcs.filter((a) => !active.includes(a));
  const quests = entries?.filter((e) => e.kind === "quest") ?? null;
  const memberOf = (actorId: string) => state.access.members.find((m) => m.characterIds.includes(actorId)) ?? null;
  const guestOf = (actorId: string) => state.access.guests.some((g) => g.actorId === actorId);
  const holderOf = (actorId: string) => memberOf(actorId)?.name ?? (guestOf(actorId) ? t("guest") : null);

  // Sends an action and shows its refusal, if any.
  const act = async (a: ActionInput) => {
    const r = await send(a);
    setError(r.ok ? null : r.error);
    return r;
  };

  // Shows a join link for a token or invite code as a QR the phones can scan.
  const show = async ({ title, path }: { title: string; path: string }) => {
    const url = `${shareOrigin(location)}${path}`;
    try {
      setShown({ title, url, qr: await qrImage(url) });
    } catch {
      setError(t("qrFailed"));
    }
  };

  // ROOM QR: a player invite to the room, the QR up at once.
  const handleRoomQr = async () => {
    const r = await act({ type: "invite.create", mode: "room", role: "player", allowGuests: true });
    if (r.ok && r.token)
      await show({ title: t("campaignInviteTitle", { role: tRoles("player") }), path: `/invite/${r.token}` });
  };

  // QUICK GAME: syncs with the api, which issues the invite; asked once however often the effect runs (dev strict mode).
  const asked = useRef(false);
  useEffect(() => {
    if (!autoQr || asked.current || !can("member:invite")) return;
    asked.current = true;
    void handleRoomQr();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // MORE's panel: its open state follows the fold, so a checklist GO TO that opens it shows it too.
  const handleMoreToggle = (e: SyntheticEvent<HTMLDetailsElement>) => setMore(e.currentTarget.open);

  const cardOf = (a: Actor) => {
    const card = ruleset
      ? partyCardOf({ ruleset, compiled, actor: a, characters: pcs.length, campaign: state.campaign.fields })
      : { line: null, bars: [], numbers: [], states: [] };
    const mine = entries ? objectivesOf({ entries, actorId: a.id }) : [];
    const objectives = { total: mine.length, done: mine.filter((e) => e.status === "done").length };
    return (
      <div key={a.id} className="party-cell">
        <PartyCard
          campaignId={state.campaign.id}
          actor={a}
          card={card}
          holder={holderOf(a.id)}
          objectives={objectives}
          onOpen={setOpenId}
        />
        {whispers && (
          <button
            className="btn sm"
            aria-label={t("whisperLabel", { name: a.name })}
            onClick={() => setWhisperTo(a.id)}
          >
            {t("whisper")}
          </button>
        )}
      </div>
    );
  };

  // The drawer of one character: STATUS, GEAR, ADVANCE and SEAT.
  const drawerOf = (a: Actor, rs: Ruleset) => {
    const gm = canInCampaign({ ctx: me, perm: gmPermOf(a.kind) });
    const xp = xpFiguresOf({ ruleset: rs, actor: a });
    const sheetOpen = !builds || !needsBuild(a);
    const ledgerEntry = gmSideOf({ me, kind: a.kind }) ? gmEntryOf({ ruleset: rs, actor: a }) : null;
    const buildHref = `/c/${state.campaign.id}/build/${a.id}`;
    const sheetProps = {
      actor: a,
      ruleset: rs,
      characters: pcs.length,
      campaign: state.campaign.fields,
      gm,
      send,
      books: sheet.books,
      campaignId: state.campaign.id,
      requestPage: sheet.requestPage,
      builderHref: gmSideOf({ me, kind: a.kind }) ? `${buildHref}?step=advance` : null,
    };
    const member = memberOf(a.id);
    return (
      <CharacterDrawer
        key={a.id}
        actor={a}
        line={partyCardOf({ ruleset: rs, compiled: null, actor: a, characters: pcs.length }).line}
        member={member}
        guest={guestOf(a.id)}
        rank={xp ? t("rank", { rank: xp.rank }) : null}
        xp={xp ? String(xp.earned) : null}
        error={error}
        onClose={() => setOpenId(null)}
        tabs={{
          status: (
            <StatusTab
              actor={a}
              ruleset={rs}
              compiled={compiled}
              state={state}
              send={send}
              act={act}
              gm={gm}
              may={{
                conditions: can("encounter:run"),
                spend: can("request:resolve"),
                call: can("test:call"),
                objectives: can("codex:write") && can("codex:reveal"),
              }}
              quests={quests && entries ? { mine: objectivesOf({ entries, actorId: a.id }), all: quests } : null}
            />
          ),
          gear: sheetOpen && a.items !== undefined ? <SheetView {...sheetProps} part="gear" /> : undefined,
          advance: (
            <div className="stack">
              {xp && (
                <p data-stat="xp">
                  {t("xp.line", { xp: xp.earned, rank: xp.rank })}
                  {xp.toSpend > 0 && <strong> · {t("xp.toSpend", { xp: xp.toSpend })}</strong>}
                </p>
              )}
              {ledgerEntry && (
                <a
                  className="btn"
                  data-state={ledgerEntry}
                  aria-label={t(`ledger.${ledgerEntry}Label`, { name: a.name })}
                  href={buildHref}
                >
                  {ledgerEntry === "review" && <span aria-hidden>● </span>}
                  {t(`ledger.${ledgerEntry}`)}
                </a>
              )}
              {builds && needsBuild(a) && !usesLedger({ ruleset: rs, actor: a }) && can("character:edit:any") && (
                <a className="btn" aria-label={t("buildLabel", { name: a.name })} href={buildHref}>
                  {state.myDraft?.actorId === a.id ? t("continueBuilding") : t("build")}
                </a>
              )}
              {sheetOpen && <SheetView {...sheetProps} part="advance" />}
            </div>
          ),
          seat: (
            <SeatTab
              actor={a}
              member={member}
              guest={guestOf(a.id)}
              act={act}
              onShow={(link) => void show(link)}
              onWhisper={whispers ? () => setWhisperTo(a.id) : null}
              may={{
                invite: can("member:invite"),
                remove:
                  member !== null &&
                  member.userId !== me.userId &&
                  canActOnMember({ ctx: me, target: { userId: member.userId, role: member.role } }),
              }}
            />
          ),
        }}
      />
    );
  };
  const opened = pcs.find((a) => a.id === openId) ?? null;
  const drawer = opened && ruleset && drawerOf(opened, ruleset);

  return (
    <div className="stack party">
      {error && !drawer && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <SessionBand
        state={state}
        send={send}
        act={act}
        onError={setError}
        draftRecap={draftRecap}
        ruleset={ruleset}
        run={can("session:run")}
        plan={can("campaign:update")}
      />

      <section className="stack" id={anchorId("characters")} tabIndex={-1}>
        <div className="party-head">
          <h2 className="head">{t("active", { count: active.length })}</h2>
          <div className="row">
            {can("member:invite") && (
              <button className="btn" onClick={handleRoomQr}>
                {t("roomQr")}
              </button>
            )}
            {can("session:run") &&
              ruleset &&
              restsOf(ruleset).map((b) => (
                <button
                  key={b.event}
                  className="btn"
                  aria-label={t("restParty", { rest: tRest(b.event) })}
                  onClick={() => act({ type: "actor.rest", event: b.event })}
                >
                  {t("restPartyButton", { rest: tRest(b.event) })}
                </button>
              ))}
            <button className="btn" aria-expanded={more} onClick={() => setMore(!more)}>
              {t("more")}
            </button>
          </div>
        </div>

        <details className="card party-more" open={more} onToggle={handleMoreToggle}>
          <summary className="head">{t("more")}</summary>
          <MorePanel
            me={me}
            state={state}
            send={send}
            act={act}
            onError={setError}
            ruleset={ruleset}
            onShow={(link) => void show(link)}
          >
            {setup}
          </MorePanel>
        </details>

        {active.length > 0 ? (
          <div className="party-grid">{active.map(cardOf)}</div>
        ) : (
          <p className="dim">{t("noneActive")}</p>
        )}
        {reserve.length > 0 && (
          <details className="stack ws-fold" open={active.length === 0 || undefined}>
            <summary className="head">{t("reserve", { count: reserve.length })}</summary>
            <div className="party-grid">{reserve.map(cardOf)}</div>
          </details>
        )}
      </section>

      {drawer}

      {shown && (
        <BottomSheet title={shown.title} onClose={() => setShown(null)}>
          <div className="stack" style={{ justifyItems: "center", textAlign: "center" }}>
            {/* A data: URL made in this browser; next/image has nothing to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qr" src={shown.qr} alt={t("qrAlt", { title: shown.title })} />
            <code className="small" style={{ wordBreak: "break-all" }}>
              {shown.url}
            </code>
          </div>
        </BottomSheet>
      )}
      {whispers && whisperTo !== null && (
        <BottomSheet title={tWhisper("title")} onClose={() => setWhisperTo(null)}>
          <WhisperPanel key={whisperTo} state={state} send={send} to={[whisperTo]} />
        </BottomSheet>
      )}
    </div>
  );
}
