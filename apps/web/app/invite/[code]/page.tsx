import { getTranslations } from "next-intl/server";

import { InvitePreview } from "@inconsistable/core-schema";

import { apiGet } from "@/app/server-api";
import { InviteAccept } from "@/components/invite/invite-accept/invite-accept";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";

type InvitePageProps = { params: Promise<{ code: string }> };

// An invite link or room QR: shows the table and lets the caller claim a seat (signed in, or as a guest if allowed).
// The api's refusal is shown as it arrives (English); the app's own lines are translated.
export default async function InvitePage({ params }: InvitePageProps) {
  const t = await getTranslations("status");
  const { code } = await params;
  try {
    const res = await apiGet(`/api/invites/${encodeURIComponent(code)}`);
    if (res.status === 400) {
      const body = ApiMessage.safeParse(await readJson(res));
      return <StatusScreen text={body.success ? body.data.message.toUpperCase() : t("invalid")} />;
    }
    const parsed = InvitePreview.safeParse(res.ok ? await res.json() : null);
    if (!parsed.success) return <StatusScreen text={t("nosignal")} />;
    return <InviteAccept code={code} preview={parsed.data} />;
  } catch {
    return <StatusScreen text={t("nosignal")} />;
  }
}
