"use client";
import { useTranslations } from "next-intl";
import { useId, useRef, useState, type FormEvent } from "react";

import { MemberRole } from "@inconsistable/core-schema";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { adminFetch, Unseated, type AdminUser } from "@/lib/admin/admin";

type UsersTabProps = { users: AdminUser[]; onChanged: () => void };

// The console's users (house decision #94): each with the platform role, an account or a device, and every seat (the
// room, the seat's role, the characters it holds). REMOVE FROM EVERY ROOM takes their seats, after their name is typed;
// rooms they own keep them. Only the display name shows: no email, no device secret.
export function UsersTab({ users, onChanged }: UsersTabProps) {
  const t = useTranslations("admin.users");
  const tRole = useTranslations("admin.room");
  const refusal = useRefusal();
  const typedId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ ok: boolean; text: string } | null>(null);
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
          text: [t("removed", { name: target.name, count: parsed.data.removed.length }), ...kept].join(" · "),
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
                        <span className="sr-only"> {u.name}</span>
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
            {t("removeTitle", { name: target?.name ?? "" })}
          </h2>
          <p>{t("removeExplain", { count: target?.seats.length ?? 0 })}</p>
          <label className="small" htmlFor={typedId}>
            {t("typeName", { name: target?.name ?? "" })}
          </label>
          <input id={typedId} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          <div className="row">
            <button className="btn primary" type="submit" disabled={busy || typed.trim() !== target?.name.trim()}>
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
