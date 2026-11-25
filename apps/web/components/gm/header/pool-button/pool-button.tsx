"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { PoolState } from "@inconsistable/core-schema";

import { PoolPad, type PoolPadProps } from "@/components/gm/header/pool-button/components/pool-pad/pool-pad";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";

type PoolButtonProps = Omit<PoolPadProps, "pool"> & { pool: PoolState };

// A pool in the GM's header: its label and value over maximum; a tap opens the pad for it.
export function PoolButton({ pool, ...pad }: PoolButtonProps) {
  const t = useTranslations("pools");
  const [open, setOpen] = useState(false);
  const label =
    pool.max !== null
      ? t("valueOf", { label: pool.label, value: pool.value, max: pool.max })
      : t("value", { label: pool.label, value: pool.value });
  return (
    <>
      <button
        className="btn pool-button"
        data-stat={pool.id}
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <span className="dim">{pool.label}</span> <strong>{pool.value}</strong>
        {pool.max !== null && <span className="dim"> / {pool.max}</span>}
      </button>
      {open && (
        <BottomSheet title={pool.label} onClose={() => setOpen(false)}>
          <PoolPad pool={pool} {...pad} />
        </BottomSheet>
      )}
    </>
  );
}
