"use client";
import { useLocale, useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";

import type { ActionInput, RoomExportReport } from "@inconsistable/core-schema";

import type { RoomConfirm } from "@/components/admin/admin-view/components/room-controls/constants";
import { ExportReport } from "@/components/ui/export-report/export-report";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { adminFetch, AdminEvents, type AdminCampaign, type AdminUser } from "@/lib/admin/admin";
import { saveExport } from "@/lib/room-export/room-export";

type RoomControlsProps = {
  campaign: AdminCampaign;
  /** Known users to seat as GM; null until loaded. */
  users: AdminUser[] | null;
  /** After an accepted step: the ledger reads the rooms again. */
  onChanged: () => void;
};

// One room's housekeeping in the admin console (house decision #94): seat a known user as GM or remove one (#121, the
// owner refused with the reason shown), end the running session
// without an award or delete the last one, archive or unarchive, delete an archived room after typing its name, and the
// room's rows of the admin log. Each step is an admin action at the room, logged by the api.
export function RoomControls({ campaign: c, users, onChanged }: RoomControlsProps) {
  const t = useTranslations("admin.room");
  const refusal = useRefusal();
  const locale = useLocale();
  const pickId = useId();
  const nameId = useId();
  const [pick, setPick] = useState("");
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState<RoomConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ ok: boolean; text: string } | null>(null);
  const [events, setEvents] = useState<AdminEvents | null>(null);
  const [saved, setSaved] = useState<{ name: string; report: RoomExportReport | null } | null>(null);
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }), [locale]);
  const session = c.latestSession;
  const running = session !== null && session.endedAt === null;

  // One admin action at this room; the answer is an action result, as a socket ack.
  const act = async (action: ActionInput, done: string) => {
    setBusy(true);
    setConfirming(null);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${c.id}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      const body = (await res?.json()) as { ok?: boolean; code?: string; message?: string; error?: string } | undefined;
      if (body?.ok) {
        setLine({ ok: true, text: done });
        onChanged();
      } else setLine({ ok: false, text: refusal({ code: body?.code, message: body?.message ?? body?.error ?? "" }) });
    } catch {
      setLine({ ok: false, text: t("failed") });
    }
    setBusy(false);
  };
  // SEAT AS GM: the picked user takes a GM seat here.
  const handleSeat = (e: FormEvent) => {
    e.preventDefault();
    const name = users?.find((u) => u.id === pick)?.name ?? "";
    void act({ type: "member.seat", userId: pick }, t("seated", { name }));
  };
  // DELETE FOR GOOD: the room and everything in it, once its name is typed.
  const handleDelete = (e: FormEvent) => {
    e.preventDefault();
    void act({ type: "campaign.delete", name: typed }, t("deleted"));
  };
  // CONFIRM: the session step asked for: end the running one without an award, or delete the last one.
  const handleConfirm = () => {
    if (session === null) return;
    const number = session.number;
    if (confirming === "abandon") void act({ type: "session.abandon" }, t("abandoned", { number }));
    else void act({ type: "session.delete", sessionId: session.id }, t("sessionDeleted", { number }));
  };
  // EXPORT: the room's document (house decision #103). The key goes in a header, so the file is fetched here and handed to
  // the browser as a download under the name the api gives it, with what it left out (#232).
  const handleExport = async (pictures: boolean) => {
    setBusy(true);
    setSaved(null);
    try {
      const res = await adminFetch(`/api/admin/campaigns/${c.id}/export${pictures ? "" : "?pictures=0"}`);
      if (!res?.ok) {
        const body = (await res?.json().catch(() => null)) as { code?: string; message?: string } | null;
        setLine({ ok: false, text: body ? refusal({ code: body.code, message: body.message ?? "" }) : t("failed") });
      } else {
        setLine(null);
        setSaved(await saveExport(res));
      }
    } catch {
      setLine({ ok: false, text: t("failed") });
    }
    setBusy(false);
  };
  // EVENT LOG: this room's rows of the admin log.
  const handleEvents = async () => {
    try {
      const res = await adminFetch(`/api/admin/events?campaignId=${c.id}`);
      const parsed = AdminEvents.safeParse(res?.ok ? await res.json() : null);
      if (parsed.success) setEvents(parsed.data);
      else setLine({ ok: false, text: t("failed") });
    } catch {
      setLine({ ok: false, text: t("failed") });
    }
  };

  return (
    <div className="stack">
      <p className="small dim">{t("gms", { names: c.gms.map((g) => g.name).join(", ") || t("none") })}</p>
      {c.gms.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap" }}>
          {c.gms.map((g) => (
            <button
              key={g.userId}
              className="btn sm"
              disabled={busy}
              onClick={() => act({ type: "member.remove", userId: g.userId }, t("removed", { name: g.name }))}
            >
              {t("removeGm", { name: g.name })}
            </button>
          ))}
        </div>
      )}
      {c.tableMode === "gm" && (
        <form className="row" onSubmit={handleSeat}>
          <label className="sr-only" htmlFor={pickId}>
            {t("pickUser")}
          </label>
          <select id={pickId} value={pick} onChange={(e) => setPick(e.target.value)} disabled={users === null}>
            <option value="">{users === null ? t("loadingUsers") : t("pickUser")}</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button className="btn sm" type="submit" disabled={busy || pick === ""}>
            {t("seatGm")}
          </button>
        </form>
      )}
      {session !== null && (
        <div className="row">
          {confirming === null ? (
            <button
              className="btn sm"
              disabled={busy || c.archived}
              onClick={() => setConfirming(running ? "abandon" : "deleteSession")}
            >
              {running ? t("abandon", { number: session.number }) : t("deleteSession", { number: session.number })}
            </button>
          ) : (
            <>
              <span className="small">
                {confirming === "abandon"
                  ? t("abandonAsk", { number: session.number })
                  : t("deleteSessionAsk", { number: session.number })}
              </span>
              <button className="btn sm primary" disabled={busy} onClick={handleConfirm}>
                {t("confirm")}
              </button>
              <button className="btn sm" onClick={() => setConfirming(null)}>
                {t("cancel")}
              </button>
            </>
          )}
        </div>
      )}
      <div className="row">
        {c.archived ? (
          <button
            className="btn sm"
            disabled={busy}
            onClick={() => act({ type: "campaign.unarchive" }, t("unarchived"))}
          >
            {t("unarchive")}
          </button>
        ) : (
          <button className="btn sm" disabled={busy} onClick={() => act({ type: "campaign.archive" }, t("archived"))}>
            {t("archive")}
          </button>
        )}
        <button className="btn sm" onClick={handleEvents}>
          {t("eventLog")}
        </button>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn sm" disabled={busy} onClick={() => void handleExport(true)}>
          {t("export")}
        </button>
        <button className="btn sm" disabled={busy} onClick={() => void handleExport(false)}>
          {t("exportWithoutPictures")}
        </button>
      </div>
      {c.archived && (
        <form className="stack" onSubmit={handleDelete}>
          <label className="small" htmlFor={nameId}>
            {t("typeName", { name: c.name })}
          </label>
          <span className="row">
            <input id={nameId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <button className="btn sm" type="submit" disabled={busy || typed.trim() !== c.name}>
              {t("deleteForGood")}
            </button>
          </span>
        </form>
      )}
      {saved && <ExportReport name={saved.name} report={saved.report} />}
      {line && (
        <p className={line.ok ? "small" : "error"} role={line.ok ? "status" : "alert"}>
          {line.text}
        </p>
      )}
      {events &&
        (events.length === 0 ? (
          <p className="small dim">{t("noEvents")}</p>
        ) : (
          <ul className="admin-events small">
            {events.map((e) => (
              <li key={e.id}>
                {date.format(new Date(e.createdAt))} · {e.action}
                {e.detail && ` · ${e.detail}`}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
