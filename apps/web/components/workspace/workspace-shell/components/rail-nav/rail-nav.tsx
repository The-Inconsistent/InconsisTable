"use client";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";

import { RAIL_LINKS, type RailCount } from "../../constants";

type RailNavProps = { counts: Record<RailCount, number> | null };

// The workspace pages. The current one is a lit brass plate, marked aria-current; a count says how many rooms and
// characters wait behind a link.
export function RailNav({ counts }: RailNavProps) {
  const t = useTranslations("workspace");
  const path = usePathname();

  return (
    <nav className="ws-nav" aria-label={t("nav")}>
      {RAIL_LINKS.map((link) => {
        const count = link.count && counts?.[link.count];
        return (
          <a
            key={link.key}
            className="ws-link"
            data-icon={link.key}
            href={link.href}
            aria-current={path === link.href ? "page" : undefined}
          >
            <span>{t(`page.${link.key}`)}</span>
            {typeof count === "number" && <span className="ws-count">{count}</span>}
          </a>
        );
      })}
    </nav>
  );
}
