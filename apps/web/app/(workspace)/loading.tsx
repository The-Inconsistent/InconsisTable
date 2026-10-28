import { useTranslations } from "next-intl";

// While a workspace page is read on the server, the rail stays and the page says it is on its way.
export default function WorkspaceLoading() {
  const t = useTranslations("workspace");
  return (
    <main className="page">
      <p className="status dim" role="status">
        {t("loading")}
      </p>
    </main>
  );
}
