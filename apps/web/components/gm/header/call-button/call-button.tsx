"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { LiveState } from "@inconsistable/core-schema";

import { CallForm } from "@/components/gm/tests/components/call-form/call-form";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { Send } from "@/hooks/use-table/use-table";

type CallButtonProps = { state: LiveState; send: Send };

// CALL A TEST in the GM's header, from any tab: the call form in a sheet that closes once the Test is called.
export function CallButton({ state, send }: CallButtonProps) {
  const t = useTranslations("gmApp.header");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("callTest")}
      </button>
      {open && (
        <BottomSheet title={t("callTest")} onClose={() => setOpen(false)}>
          <CallForm state={state} send={send} onCalled={() => setOpen(false)} />
        </BottomSheet>
      )}
    </>
  );
}
