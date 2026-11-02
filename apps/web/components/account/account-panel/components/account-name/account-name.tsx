"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { DISPLAY_NAME_MAX, RenameAccount } from "@inconsistable/core-schema";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { AccountView, ApiMessage, readJson } from "@/lib/api-reply/api-reply";

type AccountNameProps = { initial: string };

// The account's display name, renamed at InconsisID through the api, which also makes it the name tables see.
// An empty or unchanged name is not sent.
export function AccountName({ initial }: AccountNameProps) {
  const t = useTranslations("accountPage");
  const tStatus = useTranslations("status");
  const tr = useRefusal();
  const [name, setName] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Save: PATCH /api/account, then show the name as InconsisID stored it.
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = RenameAccount.safeParse({ displayName: name });
    if (!parsed.success) return setNote({ kind: "error", text: t("nameInvalid", { max: DISPLAY_NAME_MAX }) });
    if (parsed.data.displayName === saved) return setName(saved);
    setBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await readJson(res);
      const view = AccountView.safeParse(body);
      if (res.ok && view.success) {
        setName(view.data.displayName);
        setSaved(view.data.displayName);
        setNote({ kind: "ok", text: t("nameSaved") });
      } else {
        const refusal = ApiMessage.safeParse(body);
        setNote({ kind: "error", text: refusal.success ? tr(refusal.data) : t("nameFailed") });
      }
    } catch {
      setNote({ kind: "error", text: tStatus("nosignal") });
    }
    setBusy(false);
  };

  return (
    <form className="card account-name" onSubmit={handleSave}>
      <label>
        {t("displayName")}
        <input
          className="account-name-input"
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="nickname"
          aria-describedby="account-name-note"
          onChange={(e) => {
            setName(e.target.value);
            setNote(null);
          }}
        />
      </label>
      <div className="row">
        <button className="btn primary" type="submit" aria-busy={busy} disabled={busy || name.trim() === saved}>
          {t("saveName")}
        </button>
        <p id="account-name-note" className={note?.kind === "error" ? "error" : "small dim"} role="status">
          {note?.text ?? t("nameHint")}
        </p>
      </div>
    </form>
  );
}
