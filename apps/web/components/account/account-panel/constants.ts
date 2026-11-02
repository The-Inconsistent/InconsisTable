import type { AccountView } from "@/lib/api-reply/api-reply";

// The web's account page; a sign-in started on it lands back on it, and InconsisID's own account pages return to it.
export const ACCOUNT_PATH = "/account";

// Why the page has no account to show: signed out, or the api's refusal code (a message in `errors`).
export const ACCOUNT_PROBLEMS = ["signedOut", "accountNotFound", "accountUnavailable"] as const;
export type AccountProblem = (typeof ACCOUNT_PROBLEMS)[number];

// What the page renders: the account, or the reason there is none.
export type AccountState = { account: AccountView } | { problem: AccountProblem };
