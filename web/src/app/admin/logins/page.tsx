import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, SaveButton } from "@/components/fields";
import { LiveSearch } from "@/components/live-search";
import { adminAccess } from "@/lib/me";

type Row = {
  id: number;
  signed_in_at: string;
  email: string | null;
  method: "code" | "link" | "earlier";
  device: string | null;
  person: { id: string; first_name: string; last_name: string } | null;
};

const METHOD: Record<Row["method"], string> = {
  code: "Email code",
  link: "Email link",
  earlier: "Last sign-in before this log started",
};

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isoDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const ukDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Membership admin > Login activity: who signed in to the app and when, newest first. Superadmins only.
// Sign-ins are recorded by the app as they happen; the log keeps the last 12 months.
export default async function LoginActivityPage({ searchParams }: PageProps<"/admin/logins">) {
  const params = await searchParams;
  const { supabase, isSuper } = await adminAccess();
  if (!isSuper) return <NotAllowed who="superadmins" />;

  const now = new Date();
  const today = isoDay(now);
  now.setUTCDate(now.getUTCDate() - 30);
  const monthAgo = isoDay(now);
  let from = isDate(params.from) ? params.from : monthAgo;
  let to = isDate(params.to) ? params.to : today;
  if (from > to) [from, to] = [to, from];
  const q = typeof params.q === "string" ? params.q.trim() : "";

  // Dates are UK days; a day runs midnight to midnight London time, so widen by a day and trim below.
  const start = new Date(`${from}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  const { data } = await supabase
    .from("login_activity")
    .select("id, signed_in_at, email, method, device, person:people(id, first_name, last_name)")
    .gte("signed_in_at", start.toISOString())
    .lt("signed_in_at", end.toISOString())
    .order("signed_in_at", { ascending: false })
    .limit(2000);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = ((data ?? []) as unknown as Row[])
    .filter((r) => {
      const day = isoDay(new Date(r.signed_in_at));
      return day >= from && day <= to;
    })
    .filter((r) => {
      const text = [r.person?.first_name, r.person?.last_name, r.email, r.device, METHOD[r.method]].join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    });
  const people = new Set(rows.map((r) => r.person?.id ?? r.email)).size;

  return (
    <div className="space-y-6">
      <AdminNav current="logins" />
      <p className="text-slate-700">
        Every time someone signs in to the app, with the code or the link from their login email. Only superadmins can see this page.
        Sign-ins are kept for 12 months.
      </p>

      <form className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium">From</span>
          <input type="date" name="from" defaultValue={from} className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium">To</span>
          <input type="date" name="to" defaultValue={to} className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2" />
        </label>
        {q && <input type="hidden" name="q" value={q} />}
        <SaveButton variant="secondary">Show</SaveButton>
        {(from !== monthAgo || to !== today) && (
          <Link href={`/admin/logins${q ? `?q=${encodeURIComponent(q)}` : ""}`} className="py-2 text-sm text-sky-800 underline">
            Last 30 days
          </Link>
        )}
      </form>

      <LiveSearch label="Search login activity" placeholder="Search by name, email or device" initial={q} />

      <Card title={`Sign-ins from ${ukDay(from)} to ${ukDay(to)}`}>
        <p className="mb-3 text-sm text-slate-600">
          {rows.length} {rows.length === 1 ? "sign-in" : "sign-ins"} by {people} {people === 1 ? "person" : "people"}, newest first.
        </p>
        {rows.length === 0 ? (
          <p className="text-slate-700">No sign-ins in these dates.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Who</th>
                  <th className="py-2 pr-4">How</th>
                  <th className="py-2">Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const name = r.person ? `${r.person.first_name} ${r.person.last_name}` : (r.email ?? "Unknown");
                  return (
                    <tr key={r.id} aria-label={name}>
                      <td className="whitespace-nowrap py-2 pr-4">{when(r.signed_in_at)}</td>
                      <td className="py-2 pr-4">
                        {r.person ? (
                          <Link href={`/admin/members/${r.person.id}`} className="font-medium text-sky-800 underline">
                            {name}
                          </Link>
                        ) : (
                          <span>
                            {name} <span className="text-slate-500">(not matched to a member)</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">{METHOD[r.method]}</td>
                      <td className="py-2">{r.device ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
