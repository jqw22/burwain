import Link from "next/link";
import { LiveSearch } from "@/components/live-search";
import { AdminNav, NotAllowed, STATUS_LABEL } from "@/components/admin";
import { ageOn, meWithRole } from "@/lib/me";
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
    status: string;
    membership_types: { name: string; starts_on: string; ends_on: string } | null;
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

// "Jan 2027" style label for when a membership starts.
const month = (d: string | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "";

export default async function MembersPage({ searchParams }: PageProps<"/admin/members">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  // Letters, digits, spaces, @ . - ' only, so the search can't break the query.
  const q = (typeof params.q === "string" ? params.q : "").replace(/[^\p{L}\p{N} @.\-']/gu, "").trim();
  const filter = (typeof params.status === "string" && params.status in MEMBERSHIP_STATUS ? params.status : "all") as
    | MembershipStatus
    | "all";
  const sort = params.sort === "type" ? "type" : "name";

  let query = supabase
    .from("people")
    .select("id, first_name, last_name, date_of_birth, email, household_id, is_contact, households!people_household_id_fkey(lead_person_id)")
    .is("archived_at", null)
    .order("last_name")
    .order("first_name")
    .limit(1000);
  if (q) query = query.or(`first_name.ilike.*${q}*,last_name.ilike.*${q}*,email.ilike.*${q}*`);

  const today = ukToday();
  const [{ data: people }, { data: held }] = await Promise.all([
    query,
    supabase
      .from("membership_people")
      .select("person_id, memberships!inner(status, membership_types(name, starts_on, ends_on))")
      .neq("memberships.status", "cancelled"),
  ]);
  const byPerson = new Map<string, Membership[]>();
  for (const h of (held ?? []) as unknown as Held[]) {
    byPerson.set(h.person_id, [...(byPerson.get(h.person_id) ?? []), h.memberships]);
  }

  const all = ((people ?? []) as unknown as Row[]).map((p) => {
    const summary = summarise(byPerson.get(p.id) ?? [], today);
    return { ...p, ...summary, status: (summary.status === "none" && p.is_contact ? "contact" : summary.status) as MembershipStatus };
  });
  const counts = Object.fromEntries(
    (Object.keys(MEMBERSHIP_STATUS) as MembershipStatus[]).map((s) => [s, all.filter((r) => r.status === s).length]),
  ) as Record<MembershipStatus, number>;
  const rows = all.filter((r) => filter === "all" || r.status === filter);
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
    const next = new URLSearchParams({ ...(q && { q }), ...(filter !== "all" && { status: filter }), ...(sort !== "name" && { sort }), ...change });
    for (const [k, v] of [...next]) if (v === "" || (k === "sort" && v === "name") || (k === "status" && v === "all")) next.delete(k);
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
      <h1 className="text-2xl font-semibold">Members</h1>
      <AdminNav current="members" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">Everyone on the member list, with their membership status.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/members/new" className="rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-900">
            + Add new member
          </Link>
        </div>
      </div>
      <LiveSearch label="Search members" placeholder="Search by name or email" initial={q} />
      <nav aria-label="Filter by membership status" className="flex flex-wrap gap-2 text-sm">
        {(["all", ...Object.keys(MEMBERSHIP_STATUS)] as (MembershipStatus | "all")[]).map((s) => (
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
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => {
              const age = ageOn(p.date_of_birth);
              const m = p.shown;
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
                    {m && p.status !== "lapsed" ? (
                      <span className="whitespace-nowrap">{STATUS_LABEL[m.status] ?? m.status}</span>
                    ) : (
                      <span className="text-slate-400">–</span>
                    )}
                    {p.next && (
                      <span className="block text-xs text-slate-500">
                        From {month(p.next.membership_types?.starts_on)}: {STATUS_LABEL[p.next.status] ?? p.next.status}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 ${STATUS_STYLE[p.status]}`}>{MEMBERSHIP_STATUS[p.status]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
