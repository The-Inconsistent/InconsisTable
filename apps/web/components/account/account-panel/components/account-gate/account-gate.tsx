import { useTranslations } from "next-intl";

import { ACCOUNT_PATH, type AccountProblem } from "../../constants";

type AccountGateProps = { problem: AccountProblem };

// The account page without an account to show: a signed-out caller is offered sign-in, which lands back here; a refusal
// says what went wrong and offers a fresh read.
export function AccountGate({ problem }: AccountGateProps) {
  const t = useTranslations("accountPage");
  const tAccount = useTranslations("account");
  const tErrors = useTranslations("errors");

  if (problem === "signedOut") {
    return (
      <form className="ws-empty" method="post" action="/api/auth/login">
        <p className="dim">{t("signInLede")}</p>
        <input type="hidden" name="returnTo" value={ACCOUNT_PATH} />
        <button className="btn primary" type="submit">
          {tAccount("signIn")}
        </button>
      </form>
    );
  }
  return (
    <div className="ws-empty">
      <p className="error" role="alert">
        {tErrors(problem)}
      </p>
      <a className="btn" href={ACCOUNT_PATH}>
        {t("retry")}
      </a>
    </div>
  );
}
