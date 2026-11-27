"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useRef, useState, type FormEvent } from "react";

import { MemberRole } from "@inconsistable/core-schema";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { adminFetch, confirmWord, deviceTag, Unseated, type AdminUser } from "@/lib/admin/admin";

type UsersTabProps = { users: AdminUser[]; onChanged: () => void };

// The console's users (house decision #94): each with the platform role, an account or a device, when last seen, and
// every seat (the room, the seat's role, the characters it holds). An anonymous device also shows its tag, the end of its
// user id, since devices share a name (house decision #185). REMOVE FROM EVERY ROOM takes their seats, after an
// account's name or a device's tag is typed; rooms they own keep them. No email, no device secret.
export function UsersTab({ users, onChanged }: UsersTabProps) {
  const t = useTranslations("admin.users");
  const tRole = useTranslations("admin.room");
  const refusal = useRefusal();
  const format = useFormatter();
  const typedId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ ok: boolean; text: string } | null>(null);
  // A user as the console names them: a device with its tag, since devices share a name.
  const label = (u: AdminUser) => (u.account ? u.name : `${u.name} ${t("tag", { tag: deviceTag(u.id) })}`);
  const roleName = (role: string) => {
    const known = MemberRole.safeParse(role);
    return known.success ? tRole(`roles.${known.data}`) : role;
  };

  // REMOVE FROM EVERY ROOM: asks for the name first.
  const handleAsk = (u: AdminUser) => {
    setTarget(u);
    setTyped("");
    dialog.current?.showModal();
  };
  // The removal itself: every seat but those in rooms they own; the answer names what stayed and why.
  const handleRemove = async (e: FormEvent) => {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    try {
      const res = await adminFetch(`/api/admin/users/${encodeURIComponent(target.id)}/seats`, { method: "DELETE" });
      const parsed = Unseated.safeParse(res?.ok ? await res.json() : null);
      if (!parsed.success) setLine({ ok: false, text: t("failed") });
      else {
        const kept = parsed.data.kept.map((k) => `${k.campaignName}: ${refusal({ code: k.code, message: k.code })}`);
        setLine({
          ok: true,
          text: [t("removed", { name: label(target), count: parsed.data.removed.length }), ...kept].join(" · "),
        });
        onChanged();
      }
    } catch {
      setLine({ ok: false, text: t("failed") });
    }
    setBusy(false);
    dialog.current?.close();
  };

  return (
    <>
      {line && (
        <p className={line.ok ? "small" : "error"} role={line.ok ? "status" : "alert"}>
          {line.text}
        </p>
      )}
      {users.length === 0 ? (
        <p className="dim">{t("empty")}</p>
      ) : (
        <div className="ledger-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">{t("name")}</th>
                <th scope="col">{t("role")}</th>
                <th scope="col">{t("seats")}</th>
                <th scope="col">
                  <span className="sr-only">{t("actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <th scope="row">
                    {u.name}
                    <span className="dim small"> ({u.account ? t("account") : t("device")})</span>
                    {!u.account && <span className="small"> {t("tag", { tag: deviceTag(u.id) })}</span>}
                    <span className="dim small" style={{ display: "block" }}>
                      {t("seen", {
                        when: format.dateTime(new Date(u.lastSeenAt), { dateStyle: "short", timeStyle: "short" }),
                      })}
                    </span>
                  </th>
                  <td>{u.role}</td>
                  <td>
                    {u.seats.length === 0 ? (
                      <span className="dim">{t("noSeats")}</span>
                    ) : (
                      <ul className="admin-seats">
                        {u.seats.map((s) => (
                          <li key={s.campaignId}>
                            {s.campaignName} · {roleName(s.role)}
                            {s.owner && ` · ${t("owner")}`}
                            {s.characters.length > 0 && ` · ${s.characters.join(", ")}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>
                    {u.seats.length > 0 && (
                      <button type="button" className="btn sm" onClick={() => handleAsk(u)}>
                        {t("remove")}
                        <span className="sr-only"> {label(u)}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dialog ref={dialog} className="ledger-confirm" aria-labelledby="admin-unseat-title">
        <form className="stack" onSubmit={handleRemove}>
          <h2 className="head" id="admin-unseat-title">
            {t("removeTitle", { name: target ? label(target) : "" })}
          </h2>
          <p>{t("removeExplain", { count: target?.seats.length ?? 0 })}</p>
          <label className="small" htmlFor={typedId}>
            {target?.account === false
              ? t("typeTag", { tag: confirmWord(target) })
              : t("typeName", { name: target?.name ?? "" })}
          </label>
          <input id={typedId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          <div className="row">
            <button
              className="btn primary"
              type="submit"
              disabled={busy || !target || typed.trim() !== confirmWord(target)}
            >
              {t("removeConfirm")}
            </button>
            <button type="button" className="btn" onClick={() => dialog.current?.close()} autoFocus>
              {t("cancel")}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
