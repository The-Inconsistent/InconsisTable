"use client";
import { useLocale, useTranslations } from "next-intl";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  ViewTransition,
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
} from "react";

import { ADMIN_TABS, type AdminTab } from "@/components/admin/admin-view/constants";
import { RoomControls } from "@/components/admin/admin-view/components/room-controls/room-controls";
import { UsersTab } from "@/components/admin/admin-view/components/users-tab/users-tab";
import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";
import {
  ADMIN_PARAM,
  adminFetch,
  AdminCampaigns,
  AdminUsers,
  filterCampaigns,
  sortByLastPlayed,
  storeAdminKey,
  storedAdminKey,
  type AdminCampaign,
  type AdminUser,
} from "@/lib/admin/admin";

type LedgerProps = {
  campaigns: AdminCampaign[];
  onForget: () => void;
  /** Reads the rooms again after a room's step. */
  onReload: () => void;
};

// The admin ledger: every campaign on the platform, filterable, each with OPEN AS ADMIN and MANAGE (house decision
// #94), and the Users tab. Opening goes to the table as the unseated admin; the api logs it when the table connects
// (with the admin key, never a seat).
function Ledger({ campaigns, onForget, onReload }: LedgerProps) {
  const t = useTranslations("admin");
  const [tab, setTab] = useState<AdminTab>("rooms");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usersError, setUsersError] = useState(false);
  const [managing, setManaging] = useState<string | null>(null);
  const manageDialog = useRef<HTMLDialogElement>(null);
  const managed = campaigns.find((c) => c.id === managing);
  const locale = useLocale();
  const [query, setQuery] = useState("");
  // The rows follow the filter a beat behind the field, inside a transition, so they travel to their new places.
  const shown = useDeferredValue(query);
  const [filtered, setFiltered] = useState(false);
  const [target, setTarget] = useState<AdminCampaign | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const rows = useMemo(
    () => filterCampaigns({ campaigns: sortByLastPlayed(campaigns), query: shown }),
    [campaigns, shown],
  );
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }), [locale]);

  // The users and their seats, read again on each call (the api logs each read).
  const loadUsers = async () => {
    try {
      const res = await adminFetch("/api/admin/users");
      const parsed = AdminUsers.safeParse(res?.ok ? await res.json() : null);
      setUsersError(!parsed.success);
      if (parsed.success) setUsers(parsed.data);
    } catch {
      setUsersError(true);
    }
  };
  // A tab of the console; the Users tab reads the list as it opens.
  const handleTab = (next: AdminTab) => {
    setTab(next);
    if (next === "users") void loadUsers();
  };
  // MANAGE: the room's controls, with the known users to seat as GM.
  const handleManage = (c: AdminCampaign) => {
    setManaging(c.id);
    if (users === null) void loadUsers();
    manageDialog.current?.showModal();
  };
  // A room's step or a user's removal changed seats: both lists are read again.
  const handleChanged = () => {
    onReload();
    void loadUsers();
  };
  // Asks first: the dialog says the opening is logged.
  const handleAsk = (c: AdminCampaign) => {
    setTarget(c);
    dialog.current?.showModal();
  };
  const handleCancel = () => dialog.current?.close();
  // The filter field: from the first keystroke on, rows move with the filter instead of rising as a run.
  const handleFilter = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setFiltered(true);
  };

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
      <nav className="tabs" role="tablist" aria-label={t("tabsLabel")}>
        {ADMIN_TABS.map((name) => (
          <button key={name} className="tab" role="tab" aria-selected={tab === name} onClick={() => handleTab(name)}>
            {t(`tabs.${name}`)}
          </button>
        ))}
      </nav>
      {tab === "users" ? (
        <main className="page">
          {usersError && (
            <p className="error" role="alert">
              {t("usersFailed")}
            </p>
          )}
          {users === null ? (
            !usersError && <p className="dim">{t("loading")}</p>
          ) : (
            <UsersTab users={users} onChanged={handleChanged} />
          )}
        </main>
      ) : (
        <main className="page">
          <label className="stack ledger-search">
            {t("filter")}
            <input type="search" value={query} onChange={handleFilter} maxLength={100} />
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
                {/* the rows rise as a run when the ledger opens; once filtered, a row that comes back rises alone */}
                <tbody className={filtered ? undefined : "rise-list"}>
                  {rows.map((c, i) => (
                    <ViewTransition key={c.id} enter="rise" exit="fade" update="row">
                      <tr style={{ "--i": i } as CSSProperties}>
                        <th scope="row">
                          {c.name}
                          {c.archived && <span className="dim"> ({t("archived")})</span>}
                          {c.latestSession && c.latestSession.endedAt === null && (
                            <span className="small" style={{ display: "block" }}>
                              <span className="chip">{t("live")}</span>{" "}
                              {t("openSince", {
                                number: c.latestSession.number,
                                when: date.format(new Date(c.latestSession.startedAt)),
                              })}
                            </span>
                          )}
                        </th>
                        <td>{c.ownerName ?? t("noOwner")}</td>
                        <td>{c.ruleset ? `${c.ruleset} ${c.rulesetVersion}` : t("noRuleset")}</td>
                        <td>{c.lastPlayedAt ? date.format(new Date(c.lastPlayedAt)) : t("never")}</td>
                        <td>
                          <span className="row">
                            <button type="button" className="btn sm" onClick={() => handleAsk(c)}>
                              {t("open")}
                              <span className="sr-only"> {c.name}</span>
                            </button>
                            <button type="button" className="btn sm" onClick={() => handleManage(c)}>
                              {t("manage")}
                              <span className="sr-only"> {c.name}</span>
                            </button>
                          </span>
                        </td>
                      </tr>
                    </ViewTransition>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      )}
      <dialog ref={manageDialog} className="ledger-confirm admin-manage" aria-labelledby="admin-manage-title">
        <div className="stack">
          <div className="row between">
            <h2 className="head" id="admin-manage-title">
              {managed?.name ?? t("room.gone")}
            </h2>
            <button type="button" className="btn sm" onClick={() => manageDialog.current?.close()} autoFocus>
              {t("close")}
            </button>
          </div>
          {managed && <RoomControls key={managed.id} campaign={managed} users={users} onChanged={handleChanged} />}
        </div>
      </dialog>
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

  // A room's step changed it: the rooms are read again with the tab's key.
  const handleReload = () => {
    const key = storedAdminKey();
    if (key) void unlock(key);
  };

  if (gate.kind === "open")
    return <Ledger campaigns={gate.campaigns} onForget={handleForget} onReload={handleReload} />;
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
