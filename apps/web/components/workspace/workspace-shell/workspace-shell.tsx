import { useTranslations } from "next-intl";
import Link from "next/link";

import type { Lobby } from "@inconsistable/core-schema";

import { NameForm } from "@/components/lobby/name-form/name-form";
import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";

import { RailNav } from "./components/rail-nav/rail-nav";

type WorkspaceShellProps = { lobby: Lobby | null; children: React.ReactNode };

// The workspace frame: a wooden rail on the left (brand, the three pages, then the name and the device's settings) and
// the page beside it. On a phone the rail opens up: brand and pages become the band on top, the rest closes the page.
export function WorkspaceShell({ lobby, children }: WorkspaceShellProps) {
  const t = useTranslations("workspace");
  const tCommon = useTranslations("common");
  const counts = lobby && {
    rooms: lobby.mine.length + lobby.seated.length,
    characters: lobby.characters.length,
  };

  return (
    <div className="ws">
      <a className="skip" href="#ws-main">
        {t("skip")}
      </a>
      <aside className="ws-rail" aria-label={t("rail")}>
        <Link className="ws-brand" href="/" transitionTypes={["back"]}>
          <span className="ws-mark" aria-hidden="true" />
          <strong>{tCommon("brand")}</strong>
        </Link>
        <RailNav counts={counts} />
        <div className="ws-foot">
          {lobby && <NameForm initial={lobby.name} />}
          <div className="row">
            <LocaleSwitch />
            <ThemeSwitch />
          </div>
          <a className="ws-admin small" href="/admin">
            {t("admin")}
          </a>
        </div>
      </aside>
      <div id="ws-main" className="ws-main">
        {children}
      </div>
    </div>
  );
}
