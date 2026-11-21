"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import { WHISPER_REPLY_MAX, type WhisperReader } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";

type WhisperReplyProps = { whisperId: string; reader: WhisperReader; send: Send; onSent?: () => void };

// A reader's one reply to a whisper (house decision #93): one line of up to 200 characters; sending again replaces it.
export function WhisperReply({ whisperId, reader, send, onSent }: WhisperReplyProps) {
  const t = useTranslations("whisper");
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // SEND: the reply as whisper.reply; the box clears once the server has it.
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await send({ type: "whisper.reply", whisperId, actorId: reader.actorId, text });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    setText("");
    onSent?.();
  };

  return (
    <form className="stack" onSubmit={handleSubmit}>
      {reader.reply !== null && <p className="small">{t("replied", { reply: reader.reply })}</p>}
      <label className="small dim" htmlFor={id}>
        {t("reply")}
      </label>
      <span className="row">
        <input
          id={id}
          value={text}
          maxLength={WHISPER_REPLY_MAX}
          placeholder={reader.reply !== null ? t("changeReply") : t("replyPlaceholder")}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="btn primary" type="submit" disabled={busy || text.trim() === ""}>
          {t("send")}
        </button>
      </span>
      <span className="small dim" aria-live="polite">
        {t("counter", { used: text.length, max: WHISPER_REPLY_MAX })}
      </span>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
