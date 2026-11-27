"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

import {
  CampaignName,
  CogmScope,
  canActOnMember,
  canGrantRole,
  canInCampaign,
  MemberRole,
  type ActionInput,
  type ActionResult,
  type AscendKind,
  type LiveState,
  type Me,
  type Member,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { AscensionPanel } from "@/components/builder/ledger/play/ascension-panel/ascension-panel";
import { Journal } from "@/components/gm/party/components/journal/journal";
import { OpenInvites } from "@/components/gm/party/components/open-invites/open-invites";
import { SafetyPanel } from "@/components/gm/party/safety-panel";
import { PrintParty } from "@/components/print/print-party/print-party";
import type { Send } from "@/hooks/use-table/use-table";
import { anchorId } from "@/lib/checklist/checklist";
import { ascensionMembersOf, roomTier } from "@/lib/ledger/table";

type MorePanelProps = {
  me: Me;
  state: LiveState;
  send: Send;
  act: (a: ActionInput) => Promise<ActionResult>;
  onError: (error: string | null) => void;
  ruleset: Ruleset | null;
  /** Shows a join link as a QR (PARTY's sheet). */
  onShow: (link: { title: string; path: string }) => void;
  /** The host's own setup pieces (the setup checklist, how the table sits), first. */
  children?: ReactNode;
};

const SCOPE_KEY = {
  combat: "combat",
  codex: "codex",
  "codex.secrets": "secrets",
  party: "party",
  session: "session",
} as const satisfies Record<CogmScope, string>;

// PARTY › MORE: everything the table needs now and then, out of the way of the cards: setting up, invites and screens,
// a new character, prints, the table's lines, Ascension, the journal, the seats and the room itself.
export function MorePanel({ me, state, send, act, onError, ruleset, onShow, children }: MorePanelProps) {
  const t = useTranslations("party");
  const tRoles = useTranslations("roles");
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("player");
  const [deleteName, setDeleteName] = useState("");
  const [ascending, setAscending] = useState(false);
  const [ascendRefusal, setAscendRefusal] = useState<string | null>(null);
  const isOwner = me.userId !== null && me.userId === state.campaign.ownerUserId;
  const can = (perm: Parameters<typeof canInCampaign>[0]["perm"]) => canInCampaign({ ctx: me, perm });
  const actorNames = new Map(state.actors.map((a) => [a.id, a.name]));
  // A ruleset with no creation steps (a board game) has nothing to build: a new character takes its only actor type
  // at once, so the server gives it its starting resources (house decision #23).
  const builds = (ruleset?.creation.length ?? 0) > 0;
  const actorTypes = ruleset?.entities.filter((e) => e.base === "actor") ?? [];
  const typeOnCreate = !builds && actorTypes.length === 1 ? actorTypes[0]?.id : undefined;
  const ledgerBuild = ruleset?.build;
  const tier = ruleset ? roomTier({ ruleset, campaign: state.campaign.fields }) : 0;
  const latest = state.journal[0]; // offered for deleting between sessions
  const transferTo = state.access.transfer;

  // INVITE AS: a room invite for the chosen role (players by anyone allowed; GMs and co-GMs by the owner).
  const handleInvite = async () => {
    const r = await act({
      type: "invite.create",
      mode: "room",
      role: inviteRole,
      allowGuests: inviteRole === "player",
    });
    if (r.ok && r.token)
      onShow({ title: t("campaignInviteTitle", { role: tRoles(inviteRole) }), path: `/invite/${r.token}` });
  };
  // SCREEN QR: the TV at the table joins read-only.
  const handleScreen = async () => {
    const r = await act({ type: "screen.issue" });
    if (r.ok && r.token) onShow({ title: t("tableScreen"), path: `/join/${r.token}` });
  };
  // INVITE AS: the role picker; only a role from the closed set is taken.
  const handleInviteRole = (e: ChangeEvent<HTMLSelectElement>) => {
    const role = MemberRole.safeParse(e.target.value);
    if (role.success) setInviteRole(role.data);
  };
  // NEW CHARACTER, for a pregen or a player who'll claim it from the room QR.
  const handleNewCharacter = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const r = await act({ type: "actor.create", kind: "pc", name: newName.trim(), entityType: typeOnCreate });
    if (r.ok) setNewName("");
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
    if (!parsed.success) return onError(t("renameInvalid"));
    if ((await act({ type: "campaign.update", name: parsed.data })).ok) setRenameTo("");
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      {children}

      <section className="stack" id={anchorId("invite")} tabIndex={-1}>
        <h3 className="head">{t("invite")}</h3>
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
          <button className="btn" onClick={handleInvite} style={{ alignSelf: "end" }}>
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
        {can("member:invite") && (
          <OpenInvites invites={state.access.invites} names={actorNames} send={send} onError={onError} />
        )}
      </section>

      {(can("character:create") || ruleset) && (
        <section className="stack">
          <h3 className="head">{t("characters")}</h3>
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
          <PrintParty state={state} ruleset={ruleset} />
        </section>
      )}

      {can("session:run") && <SafetyPanel safety={state.campaign.safety} send={send} />}

      {ruleset && ledgerBuild?.ascension && ledgerBuild.xp && can("campaign:update") && (
        <details className="stack ws-fold" id={anchorId("ascension")} tabIndex={-1}>
          <summary className="head">{t("ascension", { tier })}</summary>
          <AscensionPanel
            tier={tier}
            topTier={ledgerBuild.params.tiers.max}
            needed={ledgerBuild.ascension.xp}
            members={ascensionMembersOf({ ruleset, actors: state.actors, campaign: state.campaign.fields })}
            busy={ascending}
            refusal={ascendRefusal}
            onAscend={handleAscend}
          />
        </details>
      )}

      {can("session:run") && (
        <>
          <Journal
            journal={state.journal}
            send={send}
            onError={onError}
            showAward={Boolean(ledgerBuild?.xp && ledgerBuild.award)}
            notes={state.campaign.tableMode === "gm"}
          />
          {!state.session && latest && (
            <div className="row">
              <button className="btn" onClick={() => act({ type: "session.delete", sessionId: latest.id })}>
                {t("deleteSession", { number: latest.number })}
              </button>
            </div>
          )}
        </>
      )}

      <section className="stack">
        <h3 className="head">{t("seats")}</h3>
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
          <h3 className="head">{t("campaign")}</h3>
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
