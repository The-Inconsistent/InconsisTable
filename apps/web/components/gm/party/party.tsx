"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import {
  CogmScope,
  canActOnMember,
  canGrantRole,
  canInCampaign,
  MemberRole,
  type ActionInput,
  type BookSource,
  type LiveState,
  type Me,
  type Member,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { ROLE_LABEL } from "@/app/constants";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { Creatures } from "@/components/gm/creatures/creatures";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { needsBuild } from "@/lib/builder/builder";
import { restsOf } from "@/lib/sheet/sheet";
import { qrImage } from "@/lib/qr/qr";
import { shareOrigin } from "@/lib/share-origin/share-origin";

type PartyProps = {
  me: Me;
  state: LiveState;
  send: Send;
  /** What a character sheet needs: the ruleset as the GM reads it, the served books and the page relay. */
  sheet: { ruleset: Ruleset | null; books: readonly BookSource[]; requestPage: RequestPage };
};

const SCOPE_LABEL: Record<CogmScope, string> = {
  combat: "Combat",
  codex: "Codex",
  "codex.secrets": "Secrets",
  party: "Party",
  session: "Session",
};

// A link the phones open, shown as a QR and as text to copy.
type Shown = { title: string; url: string; qr: string };

// PARTY: who sits at this table, how others join, and the room's owner controls (docs/design.md §3.6, §3.7).
export function Party({ me, state, send, sheet }: PartyProps) {
  const router = useRouter();
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("player");
  const [deleteName, setDeleteName] = useState("");
  const [sheetOf, setSheetOf] = useState<string | null>(null);
  const isOwner = me.userId !== null && me.userId === state.campaign.ownerUserId;
  const can = (perm: Parameters<typeof canInCampaign>[0]["perm"]) => canInCampaign({ ctx: me, perm });
  const holderOf = (actorId: string) =>
    state.access.members.find((m) => m.characterIds.includes(actorId))?.name ??
    (state.access.guests.some((g) => g.actorId === actorId) ? "Guest" : null);
  const actorNames = useMemo(() => new Map(state.actors.map((a) => [a.id, a.name])), [state.actors]);

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
      setError("Couldn't draw the QR code. Try again");
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
    if (r.ok && r.token) await show({ title: `Room invite · ${ROLE_LABEL[inviteRole]}`, path: `/invite/${r.token}` });
  };

  // GUEST QR for one character: a phone without an account plays it.
  const handleGuest = async ({ actorId, name }: { actorId: string; name: string }) => {
    const r = await act({ type: "token.issue", actorId });
    if (r.ok && r.token) await show({ title: `Guest QR · ${name}`, path: `/join/${r.token}` });
  };

  // SCREEN QR: the TV at the table joins read-only.
  const handleScreen = async () => {
    const r = await act({ type: "screen.issue" });
    if (r.ok && r.token) await show({ title: "Table screen", path: `/join/${r.token}` });
  };

  // NEW CHARACTER, for a pregen or a player who'll claim it from the room QR.
  const handleNewCharacter = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const r = await act({ type: "actor.create", kind: "pc", name: newName.trim() });
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

  // DELETE FOR GOOD: only an archived room, after typing its name; then back to the lobby.
  const handleDelete = async () => {
    if ((await act({ type: "campaign.delete", name: deleteName })).ok) router.push("/");
  };

  const transferTo = state.access.transfer;

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
            <button className="btn" onClick={() => act({ type: "session.end" })}>
              End session {state.session.number}
            </button>
          ) : (
            <button className="btn primary" onClick={() => act({ type: "session.start" })}>
              Start a session
            </button>
          )}
        </section>
      )}

      <section className="stack">
        <h2 className="head">Invite</h2>
        <div className="row">
          <label>
            As
            <select id="invite-role" value={inviteRole} onChange={handleInviteRole}>
              {MemberRole.options
                .filter((role) => canGrantRole({ ctx: me, role }))
                .map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABEL[role]}
                  </option>
                ))}
            </select>
          </label>
          <button className="btn primary" onClick={handleInvite} style={{ alignSelf: "end" }}>
            Room QR
          </button>
          <button className="btn" onClick={handleScreen} style={{ alignSelf: "end" }}>
            Screen QR
          </button>
          {state.access.screens > 0 && (
            <button className="btn" onClick={() => act({ type: "screen.revoke" })} style={{ alignSelf: "end" }}>
              Revoke screens ({state.access.screens})
            </button>
          )}
        </div>
        {shown && (
          <div className="card" style={{ justifyItems: "center", textAlign: "center" }}>
            <strong>{shown.title}</strong>
            {/* A data: URL made in this browser; next/image has nothing to optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qr" src={shown.qr} alt={`QR code for ${shown.title}`} />
            <code className="small" style={{ wordBreak: "break-all" }}>
              {shown.url}
            </code>
            <button className="btn sm" onClick={() => setShown(null)}>
              Hide
            </button>
          </div>
        )}
      </section>

      <section className="stack">
        <h2 className="head">Characters</h2>
        <ul className="list">
          {state.actors
            .filter((a) => a.kind === "pc")
            .map((a) => {
              const holder = holderOf(a.id);
              return (
                <li key={a.id}>
                  <span>
                    <strong>{a.name}</strong> <span className="dim small">{holder ?? "Open"}</span>
                  </span>
                  <span className="row">
                    {sheet.ruleset && !needsBuild(a) && (
                      <button
                        className="btn sm"
                        aria-label={`${sheetOf === a.id ? "Close" : "Open"} the sheet of ${a.name}`}
                        aria-expanded={sheetOf === a.id}
                        onClick={() => setSheetOf(sheetOf === a.id ? null : a.id)}
                      >
                        Sheet
                      </button>
                    )}
                    {needsBuild(a) && can("character:edit:any") && (
                      <a
                        className="btn sm"
                        aria-label={`Build ${a.name}`}
                        href={`/c/${state.campaign.id}/build/${a.id}`}
                      >
                        {state.myDraft?.actorId === a.id ? "Continue building" : "Build"}
                      </a>
                    )}
                    <button
                      className="btn sm"
                      aria-label={`Guest QR for ${a.name}`}
                      onClick={() => handleGuest({ actorId: a.id, name: a.name })}
                    >
                      Guest QR
                    </button>
                    {state.access.guests.some((g) => g.actorId === a.id) && (
                      <button
                        className="btn sm"
                        aria-label={`Revoke guest of ${a.name}`}
                        onClick={() => act({ type: "token.revoke", actorId: a.id })}
                      >
                        Revoke guest
                      </button>
                    )}
                  </span>
                  {sheet.ruleset && sheetOf === a.id && (
                    <div className="card" style={{ width: "100%" }}>
                      <SheetView
                        key={a.id}
                        actor={a}
                        ruleset={sheet.ruleset}
                        characters={state.actors.filter((x) => x.kind === "pc").length}
                        gm
                        send={send}
                        books={sheet.books}
                        requestPage={sheet.requestPage}
                      />
                    </div>
                  )}
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
                aria-label={`${b.label} for the whole party`}
                onClick={() => act({ type: "actor.rest", event: b.event })}
              >
                {b.label} (party)
              </button>
            ))}
          </div>
        )}
        {can("character:create") && (
          <form className="row" onSubmit={handleNewCharacter}>
            <input
              id="party-new-character"
              aria-label="New character name"
              placeholder="New character name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              style={{ flex: 1 }}
            />
            <button className="btn">Add</button>
          </form>
        )}
      </section>

      <section className="stack">
        <h2 className="head">Seats</h2>
        <ul className="list">
          {state.access.members.map((m) => {
            const owner = m.userId === state.campaign.ownerUserId;
            const removable = canActOnMember({ ctx: me, target: { userId: m.userId, role: m.role } });
            return (
              <li key={m.userId}>
                <span>
                  <strong>{m.name}</strong> <span className="chip">{owner ? "Owner" : ROLE_LABEL[m.role]}</span>
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
                      aria-label={`Seat of ${m.name}`}
                      value={m.role}
                      onChange={handleAppoint(m)}
                    >
                      {MemberRole.options.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  )}
                  {isOwner && !owner && m.role !== "player" && (
                    <button
                      className="btn sm"
                      aria-label={`Offer the room to ${m.name}`}
                      disabled={transferTo?.toUserId === m.userId}
                      onClick={() => act({ type: "campaign.transfer", toUserId: m.userId })}
                    >
                      Offer the room
                    </button>
                  )}
                  {removable && m.userId !== me.userId && (
                    <button
                      className="btn sm"
                      aria-label={`Remove ${m.name}`}
                      onClick={() => act({ type: "member.remove", userId: m.userId })}
                    >
                      Remove
                    </button>
                  )}
                </span>
                {isOwner && m.role === "cogm" && (
                  <div className="row" role="group" aria-label={`Scopes of ${m.name}`} style={{ width: "100%" }}>
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
                        {SCOPE_LABEL[s]}
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
              Waiting for {state.access.members.find((m) => m.userId === transferTo.toUserId)?.name ?? "them"} to accept
              the room.
            </span>
            <button className="btn sm" onClick={() => act({ type: "campaign.transferCancel" })}>
              Cancel offer
            </button>
          </p>
        )}
      </section>

      {can("campaign:archive") && (
        <section className="stack">
          <h2 className="head">Room</h2>
          <div className="row">
            {state.campaign.archived ? (
              <button className="btn" onClick={() => act({ type: "campaign.unarchive" })}>
                Unarchive
              </button>
            ) : (
              <button className="btn" onClick={() => act({ type: "campaign.archive" })}>
                Archive
              </button>
            )}
          </div>
          {isOwner && state.campaign.archived && (
            <div className="row">
              <input
                id="delete-room-name"
                aria-label="Type the room's name to delete it"
                placeholder={state.campaign.name}
                value={deleteName}
                onChange={(e) => setDeleteName(e.target.value)}
              />
              <button className="btn" disabled={deleteName.trim() !== state.campaign.name} onClick={handleDelete}>
                Delete for good
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
