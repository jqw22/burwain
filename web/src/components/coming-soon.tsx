import { Card } from "./fields";

// A placeholder for a page that's in the top bar but not built yet.
export function ComingSoon({ title, about }: { title: string; about: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Card title="Coming soon">
        <p className="text-slate-700">{about}</p>
      </Card>
    </div>
  );
}
