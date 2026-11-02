import { useTranslations } from "next-intl";
import Link from "next/link";

import { ACCOUNT_PATH } from "@/components/account/account-panel/constants";
import type { AuthMe } from "@/lib/api-reply/api-reply";

type AccountBarProps = { me: AuthMe; signInFailed: boolean };

// Sign in and sign out, on deployments that have accounts (house decision #33). Plain form POSTs: the api answers
// with a redirect to the identity provider, and the browser sends the Fetch Metadata the api's CSRF check reads.
export function AccountBar({ me, signInFailed }: AccountBarProps) {
  const t = useTranslations("account");
  const tRoles = useTranslations("platformRoles");
  if (!me.signInEnabled) return null;
  return (
    <section className="card" aria-label={t("label")}>
      {me.account ? (
        <form className="row" method="post" action="/api/auth/logout">
          <strong style={{ flex: 1 }}>{t("signedInAs", { name: me.name ?? "" })}</strong>
          {me.account.roles.map((role) => (
            <span key={role} className="chip">
              {tRoles(role)}
            </span>
          ))}
          <Link className="btn" href={ACCOUNT_PATH}>
            {t("open")}
          </Link>
          <button className="btn" type="submit">
            {t("signOut")}
          </button>
        </form>
      ) : (
        <form className="row" method="post" action="/api/auth/login">
          <span className="small dim" style={{ flex: 1 }}>
            {t("anonymous")}
          </span>
          <input type="hidden" name="returnTo" value="/" />
          <button className="btn primary" type="submit">
            {t("signIn")}
          </button>
        </form>
      )}
      {signInFailed && (
        <p className="error" role="alert">
          {t("signInFailed")}
        </p>
      )}
    </section>
  );
}
