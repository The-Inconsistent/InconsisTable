"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { RAIL_LINKS, type RailCount } from "../../constants";

type RailNavProps = { counts: Record<RailCount, number> | null };

// The workspace pages. The current one is a lit brass plate, marked aria-current; a count says how many rooms and
// characters wait behind a link. Links move on the client, so the rail (and the name being typed in it) stays put.
// The lit plate glides to the new page's link. A link above the current page is a step back, so the page change
// mirrors; a page off the rail (the account) counts as below it.
export function RailNav({ counts }: RailNavProps) {
  const t = useTranslations("workspace");
  const path = usePathname();
  const found = RAIL_LINKS.findIndex((link) => link.href === path);
  const here = found === -1 ? RAIL_LINKS.length : found;

  return (
    <nav className="ws-nav" aria-label={t("nav")}>
      {RAIL_LINKS.map((link, i) => {
        const count = link.count && counts?.[link.count];
        return (
          <Link
            key={link.key}
            className="ws-link"
            data-icon={link.key}
            href={link.href}
            aria-current={i === here ? "page" : undefined}
            transitionTypes={i < here ? ["back"] : undefined}
          >
            <span>{t(`page.${link.key}`)}</span>
            {typeof count === "number" && <span className="ws-count">{count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
