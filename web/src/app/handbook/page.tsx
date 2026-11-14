import { ComingSoon } from "@/components/coming-soon";
import { requireMe } from "@/lib/me";

export default async function HandbookPage() {
  await requireMe();
  return <ComingSoon title="Handbook" about="The club handbook will appear here." />;
}
