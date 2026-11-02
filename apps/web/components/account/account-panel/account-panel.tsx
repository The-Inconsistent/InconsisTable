import { useFormatter, useTranslations } from "next-intl";

import { PageHead } from "@/components/ui/page-head/page-head";
import type { AccountView } from "@/lib/api-reply/api-reply";

import { AccountGate } from "./components/account-gate/account-gate";
import { AccountName } from "./components/account-name/account-name";
import type { AccountState } from "./constants";

type AccountPanelProps = { state: AccountState };

type MethodProps = { title: string; manage: string; href: string; children: React.ReactNode };

// One way to sign in: what InconsisID holds for it, and the link that changes it there.
function Method({ title, manage, href, children }: MethodProps) {
  return (
    <section className="card account-method" aria-label={title}>
      <h3 className="card-name">{title}</h3>
      <div className="account-method-body">{children}</div>
      <a className="btn sm" href={href}>
        {manage}
      </a>
    </section>
  );
}

// The signed-in account as InconsisID holds it. The name changes here; every credential changes on InconsisID's own
// pages (`manageUrl`), which come back to this page.
function AccountDetails({ account }: { account: AccountView }) {
  const t = useTranslations("accountPage");
  const tRoles = useTranslations("platformRoles");
  const tProviders = useTranslations("signInProviders");
  const format = useFormatter();
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const { passkeys, password, providers } = account.signInMethods;
  const href = account.manageUrl;

  return (
    <>
      <div className="account-top">
        <AccountName initial={account.displayName} />
        <dl className="card account-facts">
          <div>
            <dt className="small dim">{t("roles")}</dt>
            <dd className="row">
              {(account.roles.length ? account.roles : (["user"] as const)).map((role) => (
                <span key={role} className="chip">
                  {tRoles(role)}
                </span>
              ))}
            </dd>
          </div>
          <div>
            <dt className="small dim">{t("memberSince")}</dt>
            <dd>{date(account.createdAt)}</dd>
          </div>
        </dl>
      </div>

      <section className="stack" aria-labelledby="account-ways">
        <h2 id="account-ways" className="head">
          {t("waysIn")}
        </h2>
        <div className="grid">
          <Method title={t("passkeys")} manage={t("managePasskeys")} href={href}>
            {passkeys.length ? (
              <ul className="list">
                {passkeys.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="account-key">
                    <strong>{p.name}</strong>
                    <span className="small dim">
                      {t("passkeyAdded", { date: date(p.createdAt) })}
                      <br />
                      {p.lastUsedAt ? t("passkeyUsed", { date: date(p.lastUsedAt) }) : t("passkeyNeverUsed")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dim">{t("noPasskeys")}</p>
            )}
          </Method>
          <Method title={t("password")} manage={t("managePassword")} href={href}>
            <p className={password ? undefined : "dim"}>
              {password ? t("passwordUsername", { username: password.username }) : t("passwordNotSet")}
            </p>
          </Method>
          <Method title={t("providers")} manage={t("manageProviders")} href={href}>
            {providers.length ? (
              <p className="row">
                {providers.map((p) => (
                  <span key={p} className="chip">
                    {tProviders(p)}
                  </span>
                ))}
              </p>
            ) : (
              <p className="dim">{t("noProviders")}</p>
            )}
          </Method>
          <Method title={t("recoveryCodes")} manage={t("manageCodes")} href={href}>
            <p className="account-count">{t("codesLeft", { count: account.recoveryCodesLeft })}</p>
            {account.recoveryCodesLeft === 0 && <p className="error">{t("codesOut")}</p>}
          </Method>
        </div>
      </section>

      <section className="stack account-delete" aria-labelledby="account-delete">
        <h2 id="account-delete" className="head">
          {t("deleteTitle")}
        </h2>
        <p className="dim">{t("deleteLede")}</p>
        <a className="btn" href={href}>
          {t("deleteAccount")}
        </a>
      </section>
    </>
  );
}

// /account: the signed-in user's InconsisID account, or why it can't be shown.
export function AccountPanel({ state }: AccountPanelProps) {
  const t = useTranslations("accountPage");
  return (
    <main className="page">
      <PageHead title={t("title")} lede={t("lede")} />
      {"account" in state ? <AccountDetails account={state.account} /> : <AccountGate problem={state.problem} />}
    </main>
  );
}
