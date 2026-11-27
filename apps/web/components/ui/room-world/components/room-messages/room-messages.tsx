"use client";
import { NextIntlClientProvider, useLocale, useMessages } from "next-intl";
import { useMemo } from "react";

import { mergeMessages, type MessageTree } from "@/lib/terms/terms";

type RoomMessagesProps = { changes: MessageTree; children: React.ReactNode };

// The room's words laid over the page's messages (issue #159). Always mounted, whatever the room changes, so a World
// pinned or unpinned mid-session never remounts the table under it.
export function RoomMessages({ changes, children }: RoomMessagesProps) {
  const base: MessageTree = useMessages();
  const locale = useLocale();
  const messages = useMemo(() => mergeMessages(base, changes), [base, changes]);
  // A provider rendered from a client component must be told the locale (next-intl throws without it); the rest
  // (time zone, formats) it inherits from the root provider.
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
