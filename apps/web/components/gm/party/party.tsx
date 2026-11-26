"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import {
  CampaignName,
  CogmScope,
  canActOnMember,
  canGrantRole,
  canInCampaign,
  gmPermOf,
  MemberRole,
  type ActionInput,
  type AscendKind,
  type BookSource,
  type LiveState,
  type Me,
  type Member,
  type SessionRecap,
} from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { AscensionPanel } from "@/components/builder/ledger/play/ascension-panel/ascension-panel";
import { SessionAward } from "@/components/builder/ledger/play/session-award/session-award";
import { Recaps } from "@/components/gm/party/recaps";
import { SafetyPanel } from "@/components/gm/party/safety-panel";
import { SpendButtons } from "@/components/gm/spend-buttons/spend-buttons";
import { DraftRecap as DraftRecapButton } from "@/components/ui/draft-recap/draft-recap";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import type { DraftRecap, RequestPage, Send } from "@/hooks/use-table/use-table";
import { needsBuild } from "@/lib/builder/builder";
import { startingAward } from "@/lib/ledger/play";
import { ascensionMembersOf, gmEntryOf, gmSideOf, roomTier, usesLedger, xpFiguresOf } from "@/lib/ledger/table";
import { restsOf } from "@/lib/sheet/sheet";
import { RECAP_MAX } from "@/lib/codex/codex";
import { qrImage } from "@/lib/qr/qr";
import { shareOrigin } from "@/lib/share-origin/share-origin";

type PartyProps = {
  me: Me;
  state: LiveState;
  send: Send;
  draftRecap: DraftRecap;
  /** Past recaps, from the codex snapshot. */
  recaps: readonly SessionRecap[];
  /** What a character sheet needs: the ruleset as the GM reads it, the served books and the page relay. */
  sheet: { ruleset: Ruleset | null; books: readonly BookSource[]; requestPage: RequestPage };
  /** A quick game just made this room: the player invite QR is up on arrival. */
  autoQr?: boolean;
};

const SCOPE_KEY = {
  combat: "combat",
  codex: "codex",
  "codex.secrets": "secrets",
  party: "party",
  session: "session",
} as const satisfies Record<CogmScope, string>;

// A link the phones open, shown as a QR and as text to copy.
// `at`: the character whose Guest QR was pressed (the QR shows under its row), or null for the invite row's QRs.
type Shown = { title: string; url: string; qr: string; at: string | null };

// Brings a QR that just appeared on screen. Stable, so it runs when the card mounts, not on every render.
const bringIntoView = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest" });

// PARTY: who sits at this table, how others join, and the room's owner controls (docs/design.md §3.6, §3.7).
export function Party({ me, state, send, draftRecap, recaps, sheet, autoQr = false }: PartyProps) {
  const t = useTranslations("party");
  const tRoles = useTranslations("roles");
  const tRest = useTranslations("rest");
  const router = useRouter();
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("player");
  const [deleteName, setDeleteName] = useState("");
  const [recap, setRecap] = useState<string | null>(null); // the end-of-session form, open while not null
  const [sheetOf, setSheetOf] = useState<string | null>(null);
  const [award, setAward] = useState(0); // the session's XP award, set when the end-of-session form opens
  const [ascending, setAscending] = useState(false);
  const [ascendRefusal, setAscendRefusal] = useState<string | null>(null);
  const isOwner = me.userId !== null && me.userId === state.campaign.ownerUserId;
  const can = (perm: Parameters<typeof canInCampaign>[0]["perm"]) => canInCampaign({ ctx: me, perm });
  const holderOf = (actorId: string) =>
    state.access.members.find((m) => m.characterIds.includes(actorId))?.name ??
    (state.access.guests.some((g) => g.actorId === actorId) ? t("guest") : null);
  const actorNames = useMemo(() => new Map(state.actors.map((a) => [a.id, a.name])), [state.actors]);
  const compiled = useMemo(() => {
    const c = sheet.ruleset ? compileRuleset(sheet.ruleset) : null;
    return c?.ok ? c.compiled : null;
  }, [sheet.ruleset]);
  // A ruleset with no creation steps (a board game) has nothing to build: a new character takes its only actor type
  // at once, so the server gives it its starting resources (house decision #23), and its sheet is open from the start.
  const builds = (sheet.ruleset?.creation.length ?? 0) > 0;
  const actorTypes = sheet.ruleset?.entities.filter((e) => e.base === "actor") ?? [];
  const typeOnCreate = !builds && actorTypes.length === 1 ? actorTypes[0]?.id : undefined;
  // In play with the ledger builder (house decision #64): the XP a session's end awards, and the group's Ascension.
  const ledgerBuild = sheet.ruleset?.build;
  const awardRule = ledgerBuild?.xp ? ledgerBuild.award : undefined;
  const tier = sheet.ruleset ? roomTier({ ruleset: sheet.ruleset, campaign: state.campaign.fields }) : 0;

  // Sends an action and shows its refusal, if any.
  const act = async (a: ActionInput) => {
    const r = await send(a);
    setError(r.ok ? null : r.error);
    return r;
  };

  // REST (PARTY): rests everyone; the ones the ruleset refuses this rest in their state are left out, and the GM app's
  // notices strip names them (the restSkipped notice, house decision #81), once.
  const handleRestParty = (event: string) => act({ type: "actor.rest", event });

  // Shows a join link for a token or invite code as a QR the phones can scan.
  const show = async ({ title, path, at = null }: { title: string; path: string; at?: string | null }) => {
    const url = `${shareOrigin(location)}${path}`;
    try {
      setShown({ title, url, qr: await qrImage(url), at });
    } catch {
      setError(t("qrFailed"));
    }
  };

  // ROOM QR / INVITE: a room invite for the chosen role (players by anyone allowed; GMs and co-GMs by the owner).
  const handleInvite = async () => {
    const r = await act({
      type: "invite.create",
      mode: "room",
      role: inviteRole,
      allowGuests: inviteRole === "player",
    });
    if (r.ok && r.token)
      await show({ title: t("campaignInviteTitle", { role: tRoles(inviteRole) }), path: `/invite/${r.token}` });
  };

  // QUICK GAME: syncs with the api, which issues the invite; asked once however often the effect runs (dev strict mode).
  const asked = useRef(false);
  useEffect(() => {
    if (!autoQr || asked.current || !can("member:invite")) return;
    asked.current = true;
    void handleInvite();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // GUEST QR for one character: a phone without an account plays it.
  const handleGuest = async ({ actorId, name }: { actorId: string; name: string }) => {
    const r = await act({ type: "token.issue", actorId });
    if (r.ok && r.token) await show({ title: t("guestQrTitle", { name }), path: `/join/${r.token}`, at: actorId });
  };

  // SCREEN QR: the TV at the table joins read-only.
  const handleScreen = async () => {
    const r = await act({ type: "screen.issue" });
    if (r.ok && r.token) await show({ title: t("tableScreen"), path: `/join/${r.token}` });
  };

  // NEW CHARACTER, for a pregen or a player who'll claim it from the room QR.
  const handleNewCharacter = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const r = await act({ type: "actor.create", kind: "pc", name: newName.trim(), entityType: typeOnCreate });
    if (r.ok) setNewName("");
  };

  // INVITE AS: the role picker; only a role from the closed set is taken.
  const handleInviteRole = (e: ChangeEvent<HTMLSelectElement>) => {
    const role = MemberRole.safeParse(e.target.value);
    if (role.success) setInviteRole(role.data);
  };

  // The owner re-seats a member at the picked role.
  const handleAppoint = (m: Member) => (e: ChangeEvent<HTMLSelectElement>) => {
    const role = MemberRole.safeParse(e.target.value);
    if (role.success) void act({ type: "member.appoint", userId: m.userId, role: role.data });
  };

  // The owner's scope ticks for a co-GM.
  const handleScope = (m: Member, scope: CogmScope) => {
    const scopes = m.scopes.includes(scope) ? m.scopes.filter((s) => s !== scope) : [...m.scopes, scope];
    void act({ type: "member.appoint", userId: m.userId, role: "cogm", scopes });
  };

  // END SESSION: opens the form, the award on the middle suggested amount.
  const handleOpenEnd = () => {
    setRecap("");
    setAward(startingAward(awardRule?.suggested ?? []));
  };
  // END SESSION (confirm): sends the recap typed in the form (it may be empty) and, where the ruleset gives XP, the
  // award picked; then closes the form.
  const handleEndSession = async (e: FormEvent) => {
    e.preventDefault();
    const r = await act({ type: "session.end", recap: recap ?? "", ...(awardRule ? { award } : {}) });
    if (r.ok) setRecap(null);
  };

  // END WITHOUT AN AWARD: the recap typed so far, no award step (house decision #85).
  const handleAbandon = async () => {
    const r = await act({ type: "session.abandon", recap: recap ?? "" });
    if (r.ok) setRecap(null);
  };
  // The latest session, offered for deleting between sessions (the journal reaches only the seats that run the room).
  const latest = state.journal[0];

  // ASCEND: the whole group, one Tier; a refusal stays in the panel.
  const handleAscend = async ({ kind, waivePackage }: { kind: AscendKind; waivePackage: boolean }) => {
    setAscending(true);
    const r = await send({ type: "build.ascend", kind, waivePackage });
    setAscending(false);
    setAscendRefusal(r.ok ? null : r.error);
  };

  // DELETE FOR GOOD: only an archived room, after typing its name; then back to the lobby.
  const handleDelete = async () => {
    if ((await act({ type: "campaign.delete", name: deleteName })).ok) router.push("/");
  };

  // RENAME: the action's own name rule is checked here; the server's refusal shows in the tab's error line.
  const handleRename = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = CampaignName.safeParse(renameTo);
    if (!parsed.success) return setError(t("renameInvalid"));
    if ((await act({ type: "campaign.update", name: parsed.data })).ok) setRenameTo("");
  };

  const transferTo = state.access.transfer;
  // The QR last asked for, where it was asked for; keyed by its link, so a new one scrolls into view again.
  const qrCard = shown && (
    <div
      key={shown.url}
      ref={bringIntoView}
      className="card"
      style={{ justifyItems: "center", textAlign: "center", width: "100%" }}
    >
      <strong>{shown.title}</strong>
      {/* A data: URL made in this browser; next/image has nothing to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="qr" src={shown.qr} alt={t("qrAlt", { title: shown.title })} />
      <code className="small" style={{ wordBreak: "break-all" }}>
        {shown.url}
      </code>
      <button className="btn sm" onClick={() => setShown(null)}>
        {t("hide")}
      </button>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 24 }}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {can("session:run") && (
        <section className="row">
          {state.session ? (
            recap === null ? (
              <button className="btn" onClick={handleOpenEnd}>
                {t("endSession", { number: state.session.number })}
              </button>
            ) : (
              <form className="card stack" onSubmit={handleEndSession} style={{ width: "100%" }}>
                <DraftRecapButton draft={draftRecap} text={recap} onFill={setRecap} onError={setError} />
                <label className="stack">
                  {t("recap")}
                  <textarea
                    id="session-recap"
                    rows={5}
                    value={recap}
                    onChange={(e) => setRecap(e.target.value)}
                    maxLength={RECAP_MAX}
                    placeholder={t("recapHint")}
                    autoFocus
                  />
                </label>
                {awardRule && (
                  <SessionAward max={awardRule.max} suggested={awardRule.suggested} value={award} onChange={setAward} />
                )}
                <div className="row">
                  <button className="btn primary">{t("endSessionConfirm", { number: state.session.number })}</button>
                  <button type="button" className="btn" onClick={handleAbandon}>
                    {t("abandonSession")}
                  </button>
                  <button type="button" className="btn" onClick={() => setRecap(null)}>
                    {t("cancel")}
                  </button>
                </div>
              </form>
            )
          ) : (
            <>
              <button className="btn primary" onClick={() => act({ type: "session.start" })}>
                {t("startSession")}
              </button>
              {latest && (
                <button className="btn" onClick={() => act({ type: "session.delete", sessionId: latest.id })}>
                  {t("deleteSession", { number: latest.number })}
                </button>
              )}
            </>
          )}
        </section>
      )}

      {can("session:run") && <Recaps recaps={recaps} send={send} onError={setError} />}

      <section className="stack">
        <h2 className="head">{t("invite")}</h2>
        <div className="row">
          <label>
            {t("as")}
            <select id="invite-role" value={inviteRole} onChange={handleInviteRole}>
              {MemberRole.options
                .filter((role) => canGrantRole({ ctx: me, role }))
                .map((role) => (
                  <option key={role} value={role}>
                    {tRoles(role)}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn primary" onClick={handleInvite} style={{ alignSelf: "end" }}>
            {t("campaignQr")}
          </button>
          <button className="btn" onClick={handleScreen} style={{ alignSelf: "end" }}>
            {t("screenQr")}
          </button>
          {state.access.screens > 0 && (
            <button className="btn" onClick={() => act({ type: "screen.revoke" })} style={{ alignSelf: "end" }}>
              {t("revokeScreens", { count: state.access.screens })}
            </button>
          )}
        </div>
        {shown?.at === null && qrCard}
      </section>

      {can("session:run") && <SafetyPanel safety={state.campaign.safety} send={send} />}

      <section className="stack">
        <h2 className="head">{t("characters")}</h2>
        <ul className="list">
          {state.actors
            .filter((a) => a.kind === "pc")
            .map((a) => {
              const holder = holderOf(a.id);
              // The ledger builder's entry, for the GM side of the character (it approves the GM's part there).
              const ledgerEntry = gmSideOf({ me, kind: a.kind })
                ? gmEntryOf({ ruleset: sheet.ruleset, actor: a })
                : null;
              const xp = xpFiguresOf({ ruleset: sheet.ruleset, actor: a });
              return (
                <li key={a.id}>
                  <span>
                    <strong>{a.name}</strong> <span className="dim small">{holder ?? t("open")}</span>
                    {xp && (
                      <span className="small" data-stat="xp">
                        {" "}
                        {t("xp.line", { xp: xp.earned, rank: xp.rank })}
                        {xp.toSpend > 0 && <strong> · {t("xp.toSpend", { xp: xp.toSpend })}</strong>}
                      </span>
                    )}
                  </span>
                  <span className="row">
                    {sheet.ruleset && (!builds || !needsBuild(a)) && (
                      <button
                        className="btn sm"
                        aria-label={
                          sheetOf === a.id ? t("closeSheet", { name: a.name }) : t("openSheet", { name: a.name })
                        }
                        aria-expanded={sheetOf === a.id}
                        onClick={() => setSheetOf(sheetOf === a.id ? null : a.id)}
                      >
                        {t("sheet")}
                      </button>
                    )}
                    {ledgerEntry && (
                      <a
                        className="btn sm"
                        data-state={ledgerEntry}
                        aria-label={t(`ledger.${ledgerEntry}Label`, { name: a.name })}
                        href={`/c/${state.campaign.id}/build/${a.id}`}
                      >
                        {ledgerEntry === "review" && <span aria-hidden>● </span>}
                        {t(`ledger.${ledgerEntry}`)}
                      </a>
                    )}
                    {builds &&
                      needsBuild(a) &&
                      !usesLedger({ ruleset: sheet.ruleset, actor: a }) &&
                      can("character:edit:any") && (
                        <a
                          className="btn sm"
                          aria-label={t("buildLabel", { name: a.name })}
                          href={`/c/${state.campaign.id}/build/${a.id}`}
                        >
                          {state.myDraft?.actorId === a.id ? t("continueBuilding") : t("build")}
                        </a>
                      )}
                    <button
                      className="btn sm"
                      aria-label={t("guestQrLabel", { name: a.name })}
                      onClick={() => handleGuest({ actorId: a.id, name: a.name })}
                    >
                      {t("guestQr")}
                    </button>
                    {state.access.guests.some((g) => g.actorId === a.id) && (
                      <button
                        className="btn sm"
                        aria-label={t("revokeGuestLabel", { name: a.name })}
                        onClick={() => act({ type: "token.revoke", actorId: a.id })}
                      >
                        {t("revokeGuest")}
                      </button>
                    )}
                  </span>
                  {sheet.ruleset && can("request:resolve") && (
                    <SpendButtons ruleset={sheet.ruleset} compiled={compiled} state={state} actor={a} send={send} />
                  )}
                  {sheet.ruleset && sheetOf === a.id && (
                    <div className="card" style={{ width: "100%" }}>
                      <SheetView
                        key={a.id}
                        actor={a}
                        ruleset={sheet.ruleset}
                        characters={state.actors.filter((x) => x.kind === "pc").length}
                        campaign={state.campaign.fields}
                        gm={canInCampaign({ ctx: me, perm: gmPermOf(a.kind) })}
                        send={send}
                        books={sheet.books}
                        campaignId={state.campaign.id}
                        requestPage={sheet.requestPage}
                        builderHref={
                          gmSideOf({ me, kind: a.kind }) ? `/c/${state.campaign.id}/build/${a.id}?step=advance` : null
                        }
                      />
                    </div>
                  )}
                  {shown?.at === a.id && qrCard}
                </li>
              );
            })}
        </ul>
        {can("session:run") && sheet.ruleset && (
          <div className="row">
            {restsOf(sheet.ruleset).map((b) => (
              <button
                key={b.event}
                className="btn"
                aria-label={t("restParty", { rest: tRest(b.event) })}
                onClick={() => handleRestParty(b.event)}
              >
                {t("restPartyButton", { rest: tRest(b.event) })}
              </button>
            ))}
          </div>
        )}
        {sheet.ruleset && ledgerBuild?.ascension && ledgerBuild.xp && can("campaign:update") && (
          <details className="stack ws-fold">
            <summary className="head">{t("ascension", { tier })}</summary>
            <AscensionPanel
              tier={tier}
              topTier={ledgerBuild.params.tiers.max}
              needed={ledgerBuild.ascension.xp}
              members={ascensionMembersOf({
                ruleset: sheet.ruleset,
                actors: state.actors,
                campaign: state.campaign.fields,
              })}
              busy={ascending}
              refusal={ascendRefusal}
              onAscend={handleAscend}
            />
          </details>
        )}
        {can("character:create") && (
          <form className="row" onSubmit={handleNewCharacter}>
            <input
              id="party-new-character"
              aria-label={t("newCharacter")}
              placeholder={t("newCharacter")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              style={{ flex: 1 }}
            />
            <button className="btn">{t("add")}</button>
          </form>
        )}
      </section>

      <section className="stack">
        <h2 className="head">{t("seats")}</h2>
        <ul className="list">
          {state.access.members.map((m) => {
            const owner = m.userId === state.campaign.ownerUserId;
            const removable = canActOnMember({ ctx: me, target: { userId: m.userId, role: m.role } });
            return (
              <li key={m.userId}>
                <span>
                  <strong>{m.name}</strong> <span className="chip">{owner ? t("owner") : tRoles(m.role)}</span>
                  {m.characterIds.length > 0 && (
                    <span className="dim small">
                      {" "}
                      {m.characterIds.map((id) => actorNames.get(id) ?? "?").join(", ")}
                    </span>
                  )}
                </span>
                <span className="row">
                  {isOwner && !owner && (
                    <select
                      id={`role-${m.userId}`}
                      aria-label={t("seatOf", { name: m.name })}
                      value={m.role}
                      onChange={handleAppoint(m)}
                    >
                      {MemberRole.options.map((r) => (
                        <option key={r} value={r}>
                          {tRoles(r)}
                        </option>
                      ))}
                    </select>
                  )}
                  {isOwner && !owner && m.role !== "player" && (
                    <button
                      className="btn sm"
                      aria-label={t("offerLabel", { name: m.name })}
                      disabled={transferTo?.toUserId === m.userId}
                      onClick={() => act({ type: "campaign.transfer", toUserId: m.userId })}
                    >
                      {t("offer")}
                    </button>
                  )}
                  {removable && m.userId !== me.userId && (
                    <button
                      className="btn sm"
                      aria-label={t("removeLabel", { name: m.name })}
                      onClick={() => act({ type: "member.remove", userId: m.userId })}
                    >
                      {t("remove")}
                    </button>
                  )}
                </span>
                {isOwner && m.role === "cogm" && (
                  <div
                    className="row"
                    role="group"
                    aria-label={t("scopesOf", { name: m.name })}
                    style={{ width: "100%" }}
                  >
                    {CogmScope.options.map((s) => (
                      // The whole label is the touch target (44px); the box itself stays small.
                      <label key={s} className="row small" style={{ gap: 4, minHeight: 44 }}>
                        <input
                          type="checkbox"
                          id={`scope-${m.userId}-${s}`}
                          checked={m.scopes.includes(s)}
                          onChange={() => handleScope(m, s)}
                          style={{ minHeight: 24 }}
                        />
                        {t(`scope.${SCOPE_KEY[s]}`)}
                      </label>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {isOwner && transferTo && (
          <p className="row">
            <span className="dim">
              {t("waitingFor", {
                name: state.access.members.find((m) => m.userId === transferTo.toUserId)?.name ?? t("them"),
              })}
            </span>
            <button className="btn sm" onClick={() => act({ type: "campaign.transferCancel" })}>
              {t("cancelOffer")}
            </button>
          </p>
        )}
      </section>

      {(can("campaign:archive") || can("campaign:update")) && (
        <section className="stack">
          <h2 className="head">{t("campaign")}</h2>
          {can("campaign:update") && (
            <form className="row" onSubmit={handleRename}>
              <input
                id="rename-room"
                aria-label={t("renameLabel")}
                placeholder={state.campaign.name}
                maxLength={100}
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
              />
              <button className="btn" type="submit" disabled={renameTo.trim() === ""}>
                {t("renameSave")}
              </button>
            </form>
          )}
          {can("campaign:archive") && (
            <div className="row">
              {state.campaign.archived ? (
                <button className="btn" onClick={() => act({ type: "campaign.unarchive" })}>
                  {t("unarchive")}
                </button>
              ) : (
                <button className="btn" onClick={() => act({ type: "campaign.archive" })}>
                  {t("archive")}
                </button>
              )}
            </div>
          )}
          {can("campaign:archive") && isOwner && state.campaign.archived && (
            <div className="row">
              <input
                id="delete-room-name"
                aria-label={t("deleteLabel")}
                placeholder={state.campaign.name}
                value={deleteName}
                onChange={(e) => setDeleteName(e.target.value)}
              />
              <button className="btn" disabled={deleteName.trim() !== state.campaign.name} onClick={handleDelete}>
                {t("deleteForGood")}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
