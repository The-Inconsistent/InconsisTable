import { PhoneScreen } from "../../_screens/screens";

type PageProps = { searchParams: Promise<{ t?: string }> };

export default async function Page({ searchParams }: PageProps) {
  const { t } = await searchParams;
  return <PhoneScreen reported={t === "result"} />;
}
