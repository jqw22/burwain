import { Card } from "@/components/fields";
import { requireMe } from "@/lib/me";

export default async function VolunteerPage() {
  await requireMe();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Volunteering</h1>
      <Card title="Jobs that need doing...">
        <p className="text-slate-700">
          All clubs need jobs doing in order to improve and maintain the assets and equipment that all members use. If
          you are able to contribute to any of the jobs below, no matter how small, your support would be appreciated
          by all. Simply click the + icon to indicate where you are available.
        </p>
      </Card>
    </div>
  );
}
