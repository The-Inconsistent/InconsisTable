import { z } from "zod";

// GET /api/admin/campaigns: every room on the platform (apps/api/src/admin/admin.service.ts, listCampaigns).
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

/** Campaigns whose name or owner contains the query (case-insensitive); an empty query keeps all. */
export function filterCampaigns({ campaigns, query }: { campaigns: AdminCampaign[]; query: string }): AdminCampaign[] {
  const q = query.trim().toLowerCase();
  if (!q) return campaigns;
  return campaigns.filter((c) => c.name.toLowerCase().includes(q) || (c.ownerName ?? "").toLowerCase().includes(q));
}

/** Most recently played first; rooms never played go last, in their given order. */
export const sortByLastPlayed = (campaigns: AdminCampaign[]): AdminCampaign[] =>
  campaigns.toSorted((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? ""));
