import { ComingSoon } from "@/components/coming-soon";
import { requireMe } from "@/lib/me";

export default async function VolunteerPage() {
  await requireMe();
  return <ComingSoon title="Volunteer" about="Volunteering at the club will appear here." />;
}
