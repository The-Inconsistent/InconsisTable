import { notFound } from "next/navigation";

import { apiGet } from "@/app/server-api";
import { AccountPanel } from "@/components/account/account-panel/account-panel";
import type { AccountState } from "@/components/account/account-panel/constants";
import { AccountView, ApiMessage, readJson } from "@/lib/api-reply/api-reply";

// The caller's account at InconsisID, through the api, or why there is none to show. A 404 without the api's account
// code means this deployment has no sign-in, so it has no account page either.
async function readAccount(): Promise<AccountState> {
  let reply: { status: number; body: unknown };
  try {
    const res = await apiGet("/api/account");
    reply = { status: res.status, body: await readJson(res) };
  } catch {
    return { problem: "accountUnavailable" };
  }
  const view = AccountView.safeParse(reply.status === 200 ? reply.body : null);
  if (view.success) return { account: view.data };
  if (reply.status === 401) return { problem: "signedOut" };
  if (reply.status !== 404) return { problem: "accountUnavailable" };
  if (ApiMessage.safeParse(reply.body).data?.code === "accountNotFound") return { problem: "accountNotFound" };
  notFound();
}

// The signed-in user's own page: name, roles and ways to sign in, read from InconsisID. Credentials change on
// InconsisID's own pages, which return here.
export default async function AccountPage() {
  return <AccountPanel state={await readAccount()} />;
}
