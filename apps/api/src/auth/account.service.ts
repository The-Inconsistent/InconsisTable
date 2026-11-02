import { and, eq } from "drizzle-orm";
import type { Account, IdpClient } from "@the-inconsistent/client";
import { db } from "../core/db.ts";
import { renameUser } from "./auth.service.ts";
import { identityLink } from "./session.schema.ts";

// The account page: a signed-in user's account at the identity provider, read and renamed through the SDK (contract
// C16). Passkeys, password, recovery codes, linked providers and deletion stay on the provider's own pages, which
// `manageUrl` opens.

export type AccountIdp = {
  issuer: string;
  manageUrl: string;
  client: () => Promise<Pick<IdpClient, "account" | "renameAccount">>;
};

const subOf = async (idp: AccountIdp, userId: string) =>
  (
    await db
      .select({ sub: identityLink.sub })
      .from(identityLink)
      .where(and(eq(identityLink.iss, idp.issuer), eq(identityLink.userId, userId)))
  )[0]?.sub;

// What the web's account page reads: times as ISO strings, and no `sub`, which the page has no use for.
export const accountView = (account: Account, manageUrl: string) => ({
  displayName: account.displayName,
  roles: account.roles,
  createdAt: account.createdAt.toISOString(),
  signInMethods: {
    passkeys: account.signInMethods.passkeys.map((p) => ({
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    })),
    password: account.signInMethods.password,
    providers: account.signInMethods.providers,
  },
  recoveryCodesLeft: account.recoveryCodesLeft,
  manageUrl,
});
export type AccountView = ReturnType<typeof accountView>;

// Null when the user has no account at this issuer. An IdpError passes through for the caller to map.
export async function readAccount(idp: AccountIdp, userId: string): Promise<AccountView | null> {
  const sub = await subOf(idp, userId);
  if (!sub) return null;
  const account = await (await idp.client()).account(sub);
  return accountView(account, idp.manageUrl);
}

// The provider renames first; the name tables see follows only a rename it accepted, as it stored it.
export async function renameAccount(
  idp: AccountIdp,
  { userId, displayName }: { userId: string; displayName: string },
): Promise<AccountView | null> {
  const sub = await subOf(idp, userId);
  if (!sub) return null;
  const account = await (await idp.client()).renameAccount(sub, displayName);
  await renameUser(userId, account.displayName);
  return accountView(account, idp.manageUrl);
}
