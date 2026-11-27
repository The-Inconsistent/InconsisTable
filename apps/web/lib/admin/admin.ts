import { z } from "zod";

// GET /api/admin/campaigns: every room on the platform (Campaigns in apps/api-go/internal/admin/http.go).
export const AdminCampaign = z.object({
  id: z.uuid(),
  name: z.string(),
  ownerUserId: z.string().nullable(),
  ownerName: z.string().nullable(),
  ruleset: z.string().nullable(),
  rulesetVersion: z.string().nullable(),
  lastPlayedAt: z.string().nullable(),
  archived: z.boolean(),
  tableMode: z.string(),
  // The room's last session, running while endedAt is null (house decision #94).
  latestSession: z
    .object({ id: z.uuid(), number: z.number().int(), startedAt: z.string(), endedAt: z.string().nullable() })
    .nullable(),
  // The room's GM seats, each removable on its own (house decision #121; the owner's is refused).
  gms: z.array(z.object({ userId: z.string(), name: z.string() })),
});
export type AdminCampaign = z.infer<typeof AdminCampaign>;
export const AdminCampaigns = z.array(AdminCampaign);

// GET /api/admin/users: the most recently seen users and their seats (Users in apps/api-go/internal/admin/users.go).
export const AdminUser = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  account: z.boolean(),
  lastSeenAt: z.string(),
  seats: z.array(
    z.object({
      campaignId: z.uuid(),
      campaignName: z.string(),
      role: z.string(),
      owner: z.boolean(),
      characters: z.array(z.string()),
    }),
  ),
});
export type AdminUser = z.infer<typeof AdminUser>;

/**
 * An anonymous device's tag in the console (house decision #185): the last six characters of its user id, which tell
 * two devices named alike apart. The id is no secret (the device's cookie is); an account goes by its name.
 */
export function deviceTag(userId: string): string {
  return userId.replaceAll("-", "").slice(-6);
}

/** What the admin types to remove a user from every room: an account's name, a device's tag. */
export function confirmWord(u: Pick<AdminUser, "id" | "name" | "account">): string {
  return u.account ? u.name.trim() : deviceTag(u.id);
}
export const AdminUsers = z.array(AdminUser);

// DELETE /api/admin/users/:id/seats: the rooms left, and those kept with the refusal that kept them.
const SeatRef = z.object({ campaignId: z.uuid(), campaignName: z.string() });
export const Unseated = z.object({
  removed: z.array(SeatRef),
  kept: z.array(SeatRef.extend({ code: z.string() })),
});
export type Unseated = z.infer<typeof Unseated>;

// GET /api/admin/events?campaignId=: one room's rows of the admin log, newest first.
export const AdminEvents = z.array(
  z.object({
    id: z.string(),
    action: z.string(),
    targetUserId: z.string().nullable(),
    detail: z.string(),
    createdAt: z.string(),
  }),
);
export type AdminEvents = z.infer<typeof AdminEvents>;

/** A call to an admin route with the tab's key; null when there is none. */
export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const key = storedAdminKey();
  if (!key) return null;
  return fetch(path, { ...init, headers: { ...init.headers, "x-admin-key": key }, cache: "no-store" });
}

// The admin key lives in the tab's sessionStorage only: closing the tab forgets it. Read by the admin page (REST calls,
// header `x-admin-key`) and by the table socket when a room is opened as admin (`?admin=1`).
// ponytail: one shared key, move to an admin account once a provider exists
export const ADMIN_KEY_STORAGE = "it_admin_key";
export const ADMIN_PARAM = "admin";
export const ADMIN_PATH = "/admin";

export function storedAdminKey(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function storeAdminKey(key: string | null) {
  try {
    if (key) sessionStorage.setItem(ADMIN_KEY_STORAGE, key);
    else sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    // private mode: the key is asked for again on the next page
  }
}

/** Campaigns whose name or owner contains the query (case-insensitive); an empty query keeps all. */
export function filterCampaigns({ campaigns, query }: { campaigns: AdminCampaign[]; query: string }): AdminCampaign[] {
  const q = query.trim().toLowerCase();
  if (!q) return campaigns;
  return campaigns.filter((c) => c.name.toLowerCase().includes(q) || (c.ownerName ?? "").toLowerCase().includes(q));
}

/** Most recently played first; rooms never played go last, in their given order. */
export const sortByLastPlayed = (campaigns: AdminCampaign[]): AdminCampaign[] =>
  campaigns.toSorted((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? ""));
