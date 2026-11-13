import Link from "next/link";
import { LiveSearch } from "@/components/live-search";
import { AdminNav, NotAllowed } from "@/components/admin";
import { ageOn, meWithRole, pounds } from "@/lib/me";
import { ukToday } from "@/lib/quote";

type Row = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  email: string | null;
  household_id: string | null;
  is_contact: boolean;
  households: { lead_person_id: string | null } | null;
};
type Held = {
  person_id: string;
  memberships: {
    id: string;
    status: string;
    membership_types: { name: string; code: string; annual_price_pence: number; starts_on: string; ends_on: string } | null;
  };
};
type Membership = Held["memberships"];

// Membership status, worked out from each person's memberships:
//   Active  - has a membership running today (between its type's start and end dates)
//   Future  - none running today, but one starting later (e.g. joined or renewed for next year)
//   Lapsed  - had a membership before, but it has ended
//   None    - has never had a membership (e.g. a family member who isn't covered)
//   Contact - added as a contact for email lists, with no membership
const MEMBERSHIP_STATUS = {
  active: "Active",
  future: "Future (pending)",
  lapsed: "Lapsed",
  none: "No membership",
  contact: "Contact",
} as const;
type MembershipStatus = keyof typeof MEMBERSHIP_STATUS;
const STATUS_STYLE: Record<MembershipStatus, string> = {
  active: "bg-emerald-50 text-emerald-900",
  future: "bg-sky-50 text-sky-900",
  lapsed: "bg-slate-100 text-slate-700",
  none: "text-slate-400",
  contact: "bg-amber-50 text-amber-900",
};

type Summary = {
  status: MembershipStatus;
  shown: Membership | null; // the membership the Type and Payment columns describe
  next: Membership | null; // an active member's membership starting later, if they have one
};

function summarise(ms: Membership[], today: string): Summary {
  const live = ms.filter((m) => m.status !== "lapsed" && m.membership_types);
  const current = live.find((m) => m.membership_types!.starts_on <= today && m.membership_types!.ends_on >= today) ?? null;
  const later = live
    .filter((m) => m.membership_types!.starts_on > today)
    .sort((a, b) => a.membership_types!.starts_on.localeCompare(b.membership_types!.starts_on));
  if (current) return { status: "active", shown: current, next: later[0] ?? null };
  if (later.length > 0) return { status: "future", shown: later[0], next: null };
  const past = [...ms].sort((a, b) => (b.membership_types?.starts_on ?? "").localeCompare(a.membership_types?.starts_on ?? ""));
  if (past.length > 0) return { status: "lapsed", shown: past[0], next: null };
  return { status: "none", shown: null, next: null };
}

// Only these have filter buttons. Future and No membership people still appear under All.
const FILTERS = ["active", "lapsed"] as const;
type Filter = (typeof FILTERS)[number];

// A lapsed member's renewal shows as Outstanding for this many days after their membership ended.
const LAPSED_WINDOW_DAYS = 90;

// Renewal status:
//   Active members:
//     n/a          - membership ends more than the renewal notice (60 days) from today
//     Outstanding  - it ends within the notice period, and the next membership isn't paid (or doesn't exist yet)
//     Paid         - the next membership (starting later) is paid
//   Lapsed members:
//     Outstanding  - for 90 days after their membership ended
// Everyone else shows a dash.
const RENEWAL_STATUS = { outstanding: "Outstanding", paid: "Paid", na: "n/a" } as const;
type RenewalStatus = keyof typeof RENEWAL_STATUS;
const RENEWAL_STYLE: Record<RenewalStatus, string> = {
  outstanding: "bg-amber-50 text-amber-900",
  paid: "bg-emerald-50 text-emerald-900",
  na: "text-slate-500",
};
function renewalOf(s: Summary, today: string, noticeDays: number): RenewalStatus | null {
  if (!s.shown?.membership_types) return null;
  const ends = new Date(`${s.shown.membership_types.ends_on}T00:00:00Z`).getTime();
  const daysLeft = Math.round((ends - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
  if (s.status === "lapsed") return daysLeft >= -LAPSED_WINDOW_DAYS ? "outstanding" : null;
  if (s.status !== "active") return null;
  if (s.next?.status === "active") return "paid";
  return daysLeft > noticeDays ? "na" : "outstanding";
}

// "Jan 2027" style label for when a membership starts.
const month = (d: string | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "";

export default async function MembersPage({ searchParams }: PageProps<"/admin/members">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  // Letters, digits, spaces, @ . - ' only, so the search can't break the query.
  const q = (typeof params.q === "string" ? params.q : "").replace(/[^\p{L}\p{N} @.\-']/gu, "").trim();
  const filter = (FILTERS.includes(params.status as Filter) ? params.status : "all") as Filter | "all";
  const sort = params.sort === "type" ? "type" : "name";
  const renewalFilter = (typeof params.renewal === "string" && params.renewal in RENEWAL_STATUS ? params.renewal : "all") as
    | RenewalStatus
    | "all";

  let query = supabase
    .from("people")
    .select("id, first_name, last_name, date_of_birth, email, household_id, is_contact, households!people_household_id_fkey(lead_person_id)")
    .is("archived_at", null)
    .order("last_name")
    .order("first_name")
    .limit(1000);
  if (q) query = query.or(`first_name.ilike.*${q}*,last_name.ilike.*${q}*,email.ilike.*${q}*`);

  const today = ukToday();
  const [{ data: people }, { data: held }, { data: notice }, { data: types }] = await Promise.all([
    query,
    supabase
      .from("membership_people")
      .select("person_id, memberships!inner(id, status, membership_types(name, code, annual_price_pence, starts_on, ends_on))")
      .neq("memberships.status", "cancelled"),
    supabase.rpc("renewal_notice_days"),
    supabase.from("membership_types").select("code, annual_price_pence, starts_on").eq("is_open", true),
  ]);
  const openTypes = (types ?? []) as { code: string; annual_price_pence: number; starts_on: string }[];
  // Expected renewal fee: the full price of the next period's type with the same code (e.g. next year's
  // Family), or, if that hasn't been set up yet, the price of the type they have now.
  const expectedFee = (m: Membership | null) => {
    const t = m?.membership_types;
    if (!t) return null;
    const next = openTypes.filter((x) => x.code === t.code && x.starts_on > t.ends_on).sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
    return next?.annual_price_pence ?? t.annual_price_pence;
  };
  const noticeDays = typeof notice === "number" ? notice : 60;
  const byPerson = new Map<string, Membership[]>();
  for (const h of (held ?? []) as unknown as Held[]) {
    byPerson.set(h.person_id, [...(byPerson.get(h.person_id) ?? []), h.memberships]);
  }

  const everyone = ((people ?? []) as unknown as Row[]).map((p) => {
    const summary = summarise(byPerson.get(p.id) ?? [], today);
    return {
      ...p,
      ...summary,
      status: (summary.status === "none" && p.is_contact ? "contact" : summary.status) as MembershipStatus,
      renewal: renewalOf(summary, today, noticeDays),
    };
  });
  // Contacts (email list only, no membership) aren't members, so they aren't listed here.
  const all = everyone.filter((r) => r.status !== "contact");
  const counts = Object.fromEntries(FILTERS.map((s) => [s, all.filter((r) => r.status === s).length])) as Record<Filter, number>;
  const renewalCounts = Object.fromEntries(
    (Object.keys(RENEWAL_STATUS) as RenewalStatus[]).map((s) => [s, all.filter((r) => r.renewal === s).length]),
  ) as Record<RenewalStatus, number>;
  const rows = all.filter((r) => (filter === "all" || r.status === filter) && (renewalFilter === "all" || r.renewal === renewalFilter));
  // Sorted by name, families stay together: the main contact first, then the rest of the family indented under them.
  const grouped = new Set<string>();
  if (sort === "name") {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const key = r.household_id ?? r.id;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const ordered = [...groups.values()].map((g) => {
      const leadId = g[0].households?.lead_person_id;
      const isLead = (r: (typeof rows)[number]) => r.id === leadId;
      g.sort((a, b) => Number(isLead(b)) - Number(isLead(a)) || (a.date_of_birth ?? "").localeCompare(b.date_of_birth ?? ""));
      if (g.length > 1) g.slice(1).forEach((r) => grouped.add(r.id));
      return g;
    });
    ordered.sort((a, b) => a[0].last_name.localeCompare(b[0].last_name) || a[0].first_name.localeCompare(b[0].first_name));
    rows.splice(0, rows.length, ...ordered.flat());
  }
  const feeShown = new Set<string>();
  const expectedFor = (p: (typeof rows)[number]) => {
    if (p.renewal !== "outstanding" || !p.shown) return null;
    if (feeShown.has(p.shown.id)) return null;
    feeShown.add(p.shown.id);
    return expectedFee(p.shown);
  };
  if (sort === "type") {
    // By membership type, then name. People without a membership go last.
    rows.sort((a, b) => {
      const ta = a.shown?.membership_types?.name ?? "￿";
      const tb = b.shown?.membership_types?.name ?? "￿";
      return ta.localeCompare(tb) || a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
    });
  }

  // Links that keep the current search and filter while changing one thing.
  const href = (change: Record<string, string>) => {
    const next = new URLSearchParams({
      ...(q && { q }),
      ...(filter !== "all" && { status: filter }),
      ...(renewalFilter !== "all" && { renewal: renewalFilter }),
      ...(sort !== "name" && { sort }),
      ...change,
    });
    for (const [k, v] of [...next]) if (v === "" || (k === "sort" && v === "name") || ((k === "status" || k === "renewal") && v === "all")) next.delete(k);
    const s = next.toString();
    return s ? `/admin/members?${s}` : "/admin/members";
  };
  const sortHeader = (key: "name" | "type", label: string) => (
    <th className="px-3 py-2 font-medium" aria-sort={sort === key ? "ascending" : undefined}>
      <Link href={href({ sort: key })} className={sort === key ? "font-semibold text-sky-900 underline" : "underline decoration-dotted hover:text-sky-900"}>
        {label}
        {sort === key && <span aria-hidden="true"> ▲</span>}
      </Link>
    </th>
  );

  return (
    <div className="space-y-6">
      <AdminNav current="members" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">Everyone on the member list, with their membership and renewal status.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/members/new" className="rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-900">
            + Add new member
          </Link>
        </div>
      </div>
      <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700" open>
        <summary className="cursor-pointer font-medium text-slate-900">How status and renewal are worked out</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <h2 className="font-medium text-slate-900">Status</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li><strong>Active</strong>: has a membership running today.</li>
              <li><strong>Lapsed</strong>: had a membership, but it has ended (or was marked lapsed).</li>
              <li><strong>Future (pending)</strong>: nothing running today, but a membership starts later.</li>
              <li><strong>No membership</strong>: on the list but never had a membership, e.g. a family member who isn&apos;t covered.</li>
            </ul>
          </div>
          <div>
            <h2 className="font-medium text-slate-900">Renewal</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li><strong>n/a</strong>: active, and their membership ends more than {noticeDays} days from today.</li>
              <li>
                <strong>Outstanding</strong>: active and ending within {noticeDays} days with next year not yet paid, or lapsed within the
                last {LAPSED_WINDOW_DAYS} days.
              </li>
              <li><strong>Paid</strong>: their next membership is paid.</li>
              <li><strong>–</strong>: none of these (e.g. lapsed more than {LAPSED_WINDOW_DAYS} days ago).</li>
            </ul>
          </div>
        </div>
      </details>
      <LiveSearch label="Search members" placeholder="Search by name or email" initial={q} />
      <nav aria-label="Filter by membership status" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Membership:</span>
        {(["all", ...FILTERS] as (Filter | "all")[]).map((s) => (
          <Link
            key={s}
            href={href({ status: s })}
            aria-current={filter === s ? "true" : undefined}
            className={
              filter === s
                ? "rounded-full bg-sky-800 px-3 py-1 font-medium text-white"
                : "rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:border-sky-800"
            }
          >
            {s === "all" ? "All" : MEMBERSHIP_STATUS[s]} ({s === "all" ? all.length : counts[s]})
          </Link>
        ))}
      </nav>
      <nav aria-label="Filter by renewal status" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Renewal:</span>
        {(["all", ...Object.keys(RENEWAL_STATUS)] as (RenewalStatus | "all")[]).map((s) => (
          <Link
            key={s}
            href={href({ renewal: s })}
            aria-current={renewalFilter === s ? "true" : undefined}
            className={
              renewalFilter === s
                ? "rounded-full bg-sky-800 px-3 py-1 font-medium text-white"
                : "rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:border-sky-800"
            }
          >
            {s === "all" ? "Any" : RENEWAL_STATUS[s]}
            {s !== "all" && ` (${renewalCounts[s]})`}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-slate-600">
        Showing {rows.length} {rows.length === 1 ? "person" : "people"}
        {q && <> matching &ldquo;{q}&rdquo;</>}, sorted by {sort === "type" ? "membership type" : "name"}.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {sortHeader("name", "Name")}
              {sortHeader("type", "Type")}
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Renewal</th>
              <th className="px-3 py-2 font-medium" title="The fee if an outstanding membership is renewed as it is. Shown once per membership.">
                Expected
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => {
              const age = ageOn(p.date_of_birth);
              const m = p.shown;
              const expected = expectedFor(p);
              return (
                <tr key={p.id} className={grouped.has(p.id) ? "border-t-0 bg-slate-50/60" : undefined}>
                  <td className={grouped.has(p.id) ? "py-2 pl-8 pr-3" : "px-3 py-2"}>
                    {grouped.has(p.id) && (
                      <span aria-hidden="true" className="mr-1 text-slate-400">
                        └
                      </span>
                    )}
                    <Link href={`/admin/members/${p.id}`} className="text-sky-800 underline">
                      {p.last_name}, {p.first_name}
                    </Link>
                    {age !== null && age < 18 && <span className="ml-2 text-xs text-slate-500">junior, {age}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {m ? (
                      <>
                        {m.membership_types?.name}
                        {p.status !== "active" && <span className="text-xs text-slate-500"> ({p.status === "future" ? "from" : "ended"} {month(p.status === "future" ? m.membership_types?.starts_on : m.membership_types?.ends_on)})</span>}
                      </>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 ${STATUS_STYLE[p.status]}`}>{MEMBERSHIP_STATUS[p.status]}</span>
                  </td>
                  <td className="px-3 py-2">
                    {p.renewal ? (
                      <span
                        className={`whitespace-nowrap rounded px-2 py-0.5 ${RENEWAL_STYLE[p.renewal]}`}
                        title={p.renewal === "na" ? `Renewal opens ${noticeDays} days before ${p.shown?.membership_types?.ends_on}` : undefined}
                      >
                        {RENEWAL_STATUS[p.renewal]}
                      </span>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{expected !== null ? pounds(expected) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
