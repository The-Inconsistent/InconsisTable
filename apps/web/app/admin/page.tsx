import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { signedInUserId } from "@inconsistable/auth/next";

import { apiGet } from "@/app/server-api";
import { AdminView } from "@/components/admin/admin-view/admin-view";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { AdminCampaigns, type AdminCampaign } from "@/lib/admin/admin";

// The admin's list of campaigns. The api is the guard: it refuses anyone who is not an admin, and so does this page
// (signed out goes to sign in, a signed-in non-admin goes home). The lobby link is only a convenience.
export default async function AdminPage() {
  if (!(await signedInUserId())) redirect("/sign-in");
  let campaigns: AdminCampaign[] | null = null;
  try {
    const res = await apiGet("/api/admin/campaigns");
    if (res.status === 401 || res.status === 403) redirect("/");
    const parsed = AdminCampaigns.safeParse(res.ok ? await res.json() : null);
    campaigns = parsed.success ? parsed.data : null;
  } catch (e) {
    if (e instanceof Error && "digest" in e) throw e; // Next's redirect() is an exception: let it through
  }
  if (!campaigns) return <StatusScreen text={(await getTranslations("status"))("nosignal")} />;
  return <AdminView campaigns={campaigns} />;
}
