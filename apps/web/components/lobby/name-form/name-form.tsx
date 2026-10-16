"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { DISPLAY_NAME_MAX, Rename } from "@inconsistable/core-schema";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";

type NameFormProps = { initial: string };

// The one thing a device user sets about themselves: the name other seats see. Saved when the field loses focus or on
// Enter; an empty or unchanged name is not sent.
export function NameForm({ initial }: NameFormProps) {
  const t = useTranslations("lobby");
  const tStatus = useTranslations("status");
  const tr = useRefusal();
  const [name, setName] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const save = async () => {
    const parsed = Rename.safeParse({ name });
    if (!parsed.success) return setNote({ kind: "error", text: t("nameEmpty") });
    if (parsed.data.name === saved) return setName(saved);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        setName(parsed.data.name);
        setSaved(parsed.data.name);
        return setNote({ kind: "ok", text: t("nameSaved") });
      }
      const refusal = ApiMessage.safeParse(await readJson(res));
      setNote({ kind: "error", text: refusal.success ? tr(refusal.data) : t("nameFailed") });
    } catch {
      setNote({ kind: "error", text: tStatus("nosignal") });
    }
  };

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label>
        {t("yourName")}
        <input
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="nickname"
          onChange={(e) => {
            setName(e.target.value);
            setNote(null);
          }}
          onBlur={() => void save()}
        />
      </label>
      <p className={note?.kind === "error" ? "error" : "small dim"} role="status">
        {note?.text ?? t("nameHint")}
      </p>
    </form>
  );
}
