"use client";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { RefusalKey, type RefusalParams } from "@inconsistable/core-schema";

/** What the api sent for a refusal: its code and params, and the English message to fall back on. */
export type RefusalText = { code?: string; message: string; params?: RefusalParams };

// The refusal in this device's language. A code this build has no words for (a newer api) shows the api's message.
export function useRefusal(): (r: RefusalText) => string {
  const t = useTranslations("errors");
  return useCallback(
    (r) => {
      const code = RefusalKey.safeParse(r.code);
      return code.success ? t(code.data, r.params) : r.message;
    },
    [t],
  );
}
