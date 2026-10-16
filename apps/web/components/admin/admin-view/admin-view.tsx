"use client";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";

import { UserButton } from "@inconsistable/auth/react";

import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import { filterCampaigns, sortByLastPlayed, type AdminCampaign } from "@/lib/admin/admin";

type AdminViewProps = { campaigns: AdminCampaign[] };

// The admin ledger: every campaign on the platform, filterable, each with OPEN AS ADMIN. Opening goes to the table as
// the unseated admin; the api logs it when the table connects.
export function AdminView({ campaigns }: AdminViewProps) {
  const t = useTranslations("admin");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<AdminCampaign | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const rows = useMemo(() => filterCampaigns({ campaigns: sortByLastPlayed(campaigns), query }), [campaigns, query]);
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  // Asks first: the dialog says the opening is logged.
  const handleAsk = (c: AdminCampaign) => {
    setTarget(c);
    dialog.current?.showModal();
  };
  const handleCancel = () => dialog.current?.close();

  return (
    <>
      <header className="band">
        <a href="/">{t("back")}</a>
        <strong>{t("title")}</strong>
        <span className="row">
          <LocaleSwitch />
          <ThemeSwitch />
          <UserButton />
        </span>
      </header>
      <main className="page">
        <label className="stack ledger-search">
          {t("filter")}
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} />
        </label>
        {rows.length === 0 ? (
          <p className="dim">{t("empty")}</p>
        ) : (
          <div className="ledger-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">{t("name")}</th>
                  <th scope="col">{t("owner")}</th>
                  <th scope="col">{t("ruleset")}</th>
                  <th scope="col">{t("lastPlayed")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">
                      {c.name}
                      {c.archived && <span className="dim"> ({t("archived")})</span>}
                    </th>
                    <td>{c.ownerName ?? t("noOwner")}</td>
                    <td>{c.ruleset ? `${c.ruleset} ${c.rulesetVersion}` : t("noRuleset")}</td>
                    <td>{c.lastPlayedAt ? date.format(new Date(c.lastPlayedAt)) : t("never")}</td>
                    <td>
                      <button type="button" className="btn sm" onClick={() => handleAsk(c)}>
                        {t("open")}
                        <span className="sr-only"> {c.name}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <dialog ref={dialog} className="ledger-confirm" aria-labelledby="admin-confirm-title">
        <h2 className="head" id="admin-confirm-title">
          {t("confirmTitle", { name: target?.name ?? "" })}
        </h2>
        <p>{t("confirmLogged")}</p>
        <div className="row">
          <a className="btn primary" href={target ? `/c/${target.id}` : "#"}>
            {t("confirmOpen")}
          </a>
          <button type="button" className="btn" onClick={handleCancel} autoFocus>
            {t("cancel")}
          </button>
        </div>
      </dialog>
    </>
  );
}
