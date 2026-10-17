"use client";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import {
  ADMIN_PARAM,
  AdminCampaigns,
  filterCampaigns,
  sortByLastPlayed,
  storeAdminKey,
  storedAdminKey,
  type AdminCampaign,
} from "@/lib/admin/admin";

type LedgerProps = { campaigns: AdminCampaign[]; onForget: () => void };

// The admin ledger: every campaign on the platform, filterable, each with OPEN AS ADMIN. Opening goes to the table as
// the unseated admin; the api logs it when the table connects (with the admin key, never a seat).
function Ledger({ campaigns, onForget }: LedgerProps) {
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
          <button type="button" className="btn sm" onClick={onForget}>
            {t("forgetKey")}
          </button>
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
          <a className="btn primary" href={target ? `/c/${target.id}?${ADMIN_PARAM}=1` : "#"}>
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

type Gate =
  { kind: "loading" } | { kind: "locked"; error: string | null } | { kind: "open"; campaigns: AdminCampaign[] };

// The admin page: asks for the shared admin key, keeps it for this tab, and shows the ledger once the api accepts it.
// ponytail: one shared key, move to an admin account once a provider exists
export function AdminView() {
  const t = useTranslations("admin");
  const tStatus = useTranslations("status");
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [typed, setTyped] = useState("");

  const unlock = async (key: string) => {
    try {
      const res = await fetch("/api/admin/campaigns", { headers: { "x-admin-key": key }, cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        storeAdminKey(null);
        return setGate({ kind: "locked", error: key ? t("wrongKey") : null });
      }
      const parsed = AdminCampaigns.safeParse(res.ok ? await res.json() : null);
      if (!parsed.success) return setGate({ kind: "locked", error: tStatus("nosignal") });
      storeAdminKey(key);
      setGate({ kind: "open", campaigns: parsed.data });
    } catch {
      setGate({ kind: "locked", error: tStatus("nosignal") });
    }
  };

  useEffect(() => {
    const key = storedAdminKey();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the tab's sessionStorage, which the server can't
    if (key) void unlock(key);
    else setGate({ kind: "locked", error: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (typed.trim()) void unlock(typed.trim());
  };
  const handleForget = () => {
    storeAdminKey(null);
    setTyped("");
    setGate({ kind: "locked", error: null });
  };

  if (gate.kind === "open") return <Ledger campaigns={gate.campaigns} onForget={handleForget} />;
  return (
    <>
      <header className="band">
        <a href="/">{t("back")}</a>
        <strong>{t("title")}</strong>
        <span className="row">
          <LocaleSwitch />
          <ThemeSwitch />
        </span>
      </header>
      <main className="page">
        {gate.kind === "locked" && (
          <form className="card" onSubmit={handleSubmit}>
            <label>
              {t("keyLabel")}
              <input
                type="password"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                maxLength={500}
                autoComplete="off"
                autoFocus
              />
            </label>
            <p className="small dim">{t("keyHint")}</p>
            {gate.error && (
              <p className="error" role="alert">
                {gate.error}
              </p>
            )}
            <button className="btn primary" type="submit">
              {t("unlock")}
            </button>
          </form>
        )}
      </main>
    </>
  );
}
