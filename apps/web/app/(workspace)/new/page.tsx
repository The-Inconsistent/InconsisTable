import { getTranslations } from "next-intl/server";

import { Ruleset } from "@inconsistable/rules-engine";

import { apiGet, readLobby } from "@/app/server-api";
import { NewCampaign } from "@/components/lobby/new-campaign/new-campaign";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { FREEFORM, FREEFORM_SLUG } from "@/lib/freeform/freeform";
import { gameOptions, type GameOption } from "@/lib/games/games";
import { wizardGame, type OfferedPack, type WizardGame, type WizardOptions } from "@/lib/games/room-document";
import { ModuleList, PackList, RulesetList } from "@/lib/library/library";

// What one ruleset asks in the wizard, from its newest version's manifest; null when it cannot be read.
async function asked(id: string): Promise<WizardGame | null> {
  const res = await apiGet(`/api/rulesets/${encodeURIComponent(id)}/export`);
  const parsed = Ruleset.safeParse(res.ok ? await res.json() : null);
  return parsed.success ? wizardGame(parsed.data) : null;
}

// NEW CAMPAIGN (house decision #142): the games the creator can start, and what each asks, read here so the wizard
// fetches nothing until CREATE.
// ponytail: one export per ruleset on every visit, and a game module's ruleset is read at its newest version; a route
// that answers a version's wizard summary when libraries grow or a module pins an older version.
export default async function NewCampaignPage() {
  const t = await getTranslations("status");
  try {
    const [lobby, rulesetsRes, modulesRes, packsRes] = await Promise.all([
      readLobby(),
      apiGet("/api/rulesets"),
      apiGet("/api/modules"),
      apiGet("/api/packs"),
    ]);
    if (!lobby) return <StatusScreen text={t("nosignal")} />;
    if (!lobby.canCreate) return <StatusScreen text={t("noAccess")} />;
    const rulesets = RulesetList.safeParse(rulesetsRes.ok ? await rulesetsRes.json() : null);
    const modules = ModuleList.safeParse(modulesRes.ok ? await modulesRes.json() : null);
    const packs = PackList.safeParse(packsRes.ok ? await packsRes.json() : null);
    if (!rulesets.success || !modules.success || !packs.success) return <StatusScreen text={t("nosignal")} />;

    const bySlug = new Map(await Promise.all(rulesets.data.map(async (r) => [r.slug, await asked(r.id)] as const)));
    if (!bySlug.has(FREEFORM_SLUG)) bySlug.set(FREEFORM_SLUG, wizardGame(Ruleset.parse(FREEFORM)));
    const rulesetOf = (g: GameOption) =>
      g.moduleVersionId ? modules.data.find((m) => m.versions[0]?.id === g.moduleVersionId)?.versions[0] : undefined;
    const games = gameOptions(rulesets.data, modules.data);
    const options: WizardOptions = {};
    for (const g of games) {
      const own = rulesetOf(g);
      const slug = own?.ruleset.slug ?? g.slug;
      const game = bySlug.get(slug);
      if (!game) continue;
      const fromModule = new Set(own?.packs.map((p) => p.slug));
      const attachable = packs.data.packs.flatMap((p): OfferedPack[] => {
        const v = p.versions[0];
        return p.rulesetSlug === slug && !p.disabled && v
          ? [{ slug: p.slug, version: v.version, fromModule: fromModule.has(p.slug) }]
          : [];
      });
      options[g.key] = { ...game, packs: attachable };
    }
    return <NewCampaign games={games.filter((g) => options[g.key])} options={options} />;
  } catch {
    return <StatusScreen text={t("nosignal")} />;
  }
}
