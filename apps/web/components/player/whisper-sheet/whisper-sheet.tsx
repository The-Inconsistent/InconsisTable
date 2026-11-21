"use client";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { Actor, Whisper } from "@inconsistable/core-schema";

import { buzz } from "@/components/ui/alerts-switch/alerts-switch";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import { WhisperReply } from "@/components/ui/whisper-reply/whisper-reply";
import type { Send } from "@/hooks/use-table/use-table";
import { unreadOf } from "@/lib/whispers/whispers";

type WhisperSheetProps = {
  whispers: readonly Whisper[];
  actors: readonly Actor[];
  /** More than one character on this seat: the sheet says which one the whisper is to. */
  several: boolean;
  /** A Test is waiting on this seat: the whisper waits until it is reported. */
  waiting: boolean;
  send: Send;
};

// A whisper the GM sent pops over whatever tab is open (house decision #93), oldest unread first, one at a time, with a
// buzz as it arrives. Closing it or replying marks it read for that reader; the notebook keeps it to reread.
export function WhisperSheet({ whispers, actors, several, waiting, send }: WhisperSheetProps) {
  const t = useTranslations("whisper");
  // Closed on this page: the sheet moves on at once, even before (or without) the server's read mark.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const unread = unreadOf({ whispers, closed });
  const current = waiting ? undefined : unread[0];
  const currentKey = current?.key;

  // Syncs with the device: one buzz as each whisper comes up.
  useEffect(() => {
    if (currentKey) buzz();
  }, [currentKey]);

  if (!current) return null;
  const { whisper, reader, key } = current;
  // Put away: closed here, and read for that reader on the server.
  const handleClose = () => {
    setClosed((cur) => new Set(cur).add(key));
    void send({ type: "whisper.read", whisperId: whisper.id, actorId: reader.actorId });
  };
  const name = actors.find((a) => a.id === reader.actorId)?.name ?? "";
  return (
    <BottomSheet key={key} title={t("sheetTitle")} onClose={handleClose}>
      {several && <p className="small dim">{t("forName", { name })}</p>}
      <p className="whisper-text">{whisper.text}</p>
      <WhisperReply
        whisperId={whisper.id}
        reader={reader}
        send={send}
        onSent={() => setClosed((cur) => new Set(cur).add(key))}
      />
      {unread.length > 1 && <p className="small dim">{t("more", { count: unread.length - 1 })}</p>}
    </BottomSheet>
  );
}
