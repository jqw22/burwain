import { ComingSoon } from "@/components/coming-soon";
import { requireMe } from "@/lib/me";

export default async function CalendarPage() {
  await requireMe();
  return <ComingSoon title="Calendar" about="The club calendar will appear here." />;
}
