"use client";
import { NextIntlClientProvider, useMessages } from "next-intl";
import { useMemo } from "react";

import { mergeMessages, type MessageTree } from "@/lib/terms/terms";

type RoomMessagesProps = { changes: MessageTree; children: React.ReactNode };

// The room's words laid over the page's messages (issue #159). Always mounted, whatever the room changes, so a World
// pinned or unpinned mid-session never remounts the table under it.
export function RoomMessages({ changes, children }: RoomMessagesProps) {
  const base: MessageTree = useMessages();
  const messages = useMemo(() => mergeMessages(base, changes), [base, changes]);
  return <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>;
}
