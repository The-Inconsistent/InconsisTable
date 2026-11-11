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
});
export type AdminCampaign = z.infer<typeof AdminCampaign>;
export const AdminCampaigns = z.array(AdminCampaign);

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
