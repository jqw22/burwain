import Link from "next/link";
import { LiveSearch } from "@/components/live-search";
import { AdminNav, NotAllowed } from "@/components/admin";
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
// "New" is people whose only membership (running now or starting later) is their first one.
const FILTERS = ["active", "lapsed", "new"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = { active: "Active", lapsed: "Lapsed", new: "New" };

// Renewal bands, from the end date of the member's membership (James, 2026-11-14). Gently worded:
// "Due" covers the first 30 days after the end date. After 90 days it drops off (shows a dash).
//   n/a           - active, membership ends more than the renewal notice (60 days) from today
//   Due <60d      - ends in 31 to 60 days
//   Due <30d      - ends in the next 30 days (including today)
//   Due           - ended up to 30 days ago
//   Overdue >30d  - ended 31 to 60 days ago
//   Overdue >60d  - ended 61 to 90 days ago
//   Paid          - the next membership (starting later) is paid
// Everyone else shows a dash.
const LAPSED_WINDOW_DAYS = 90;
const RENEWAL_STATUS = {
  due60: "Due <60d",
  due30: "Due <30d",
  due: "Due",
  overdue30: "Overdue >30d",
  overdue60: "Overdue >60d",
  paid: "Paid",
  na: "n/a",
} as const;
type RenewalStatus = keyof typeof RENEWAL_STATUS;
const OUTSTANDING: RenewalStatus[] = ["due60", "due30", "due", "overdue30", "overdue60"];
// Filter buttons: every band, plus "Outstanding" for all the bands together.
type RenewalFilter = RenewalStatus | "outstanding";
const RENEWAL_STYLE: Record<RenewalStatus, string> = {
  due60: "bg-amber-50 text-amber-900",
  due30: "bg-amber-100 text-amber-900",
  due: "bg-orange-100 text-orange-900",
  overdue30: "bg-red-100 text-red-900",
  overdue60: "bg-red-200 text-red-950",
  paid: "bg-emerald-50 text-emerald-900",
  na: "text-slate-500",
};
function renewalOf(s: Summary, today: string, noticeDays: number): RenewalStatus | null {
  if (!s.shown?.membership_types) return null;
  const ends = new Date(`${s.shown.membership_types.ends_on}T00:00:00Z`).getTime();
  const daysLeft = Math.round((ends - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
  if (s.status === "lapsed") {
    const late = -daysLeft; // days since the membership ended
    if (late > LAPSED_WINDOW_DAYS) return null;
    // (Marked lapsed before its end date counts as Due too.)
    return late <= 30 ? "due" : late <= 60 ? "overdue30" : "overdue60";
  }
  if (s.status !== "active") return null;
  if (s.next?.status === "active") return "paid";
  if (daysLeft > noticeDays) return "na";
  return daysLeft > 30 ? "due60" : "due30";
}
const isOutstanding = (r: RenewalStatus | null) => r !== null && OUTSTANDING.includes(r);

// "9 Nov" style date for when a reminder was sent.
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });

// Money with pence and commas, e.g. "£1,234.00".
const money = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "31 Dec 2026" style date.
const longDate = (d: string | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

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
  const renewalFilter = (
    typeof params.renewal === "string" && (params.renewal in RENEWAL_STATUS || params.renewal === "outstanding") ? params.renewal : "all"
  ) as RenewalFilter | "all";

  let query = supabase
    .from("people")
    .select("id, first_name, last_name, date_of_birth, email, household_id, is_contact, households!people_household_id_fkey(lead_person_id)")
    .is("archived_at", null)
    .order("last_name")
    .order("first_name")
    .limit(1000);
  if (q) query = query.or(`first_name.ilike.*${q}*,last_name.ilike.*${q}*,email.ilike.*${q}*`);

  const today = ukToday();
  const [
    { data: people },
    { data: held },
    { data: notice },
    { data: types },
    { data: dueData },
    { data: boatData },
    { data: paidData },
    { data: boatRate },
  ] = await Promise.all([
    query,
    supabase
      .from("membership_people")
      .select("person_id, memberships!inner(id, status, membership_types(name, code, annual_price_pence, starts_on, ends_on))")
      .neq("memberships.status", "cancelled"),
    supabase.rpc("renewal_notice_days"),
    supabase.from("membership_types").select("code, annual_price_pence, starts_on").eq("is_open", true),
    // Main contacts with a renewal outstanding: the people a renewal reminder can be sent to.
    supabase.rpc("renewal_reminder_recipients"),
    // Boats stored for each membership (to work out boat storage expected at renewal).
    supabase.from("boat_storages").select("membership_id, person_id, household_id, ends_on").neq("status", "cancelled").not("ends_on", "is", null),
    // Money received from members: each line of a paid receipt, for a membership or a boat.
    supabase
      .from("member_receipt_lines")
      .select("amount_pence, membership_id, boat_storages(membership_id), member_receipts!inner(status)")
      .eq("member_receipts.status", "paid"),
    supabase.rpc("boat_storage_price", { p_members: true }),
  ]);
  type Boat = { membership_id: string | null; person_id: string; household_id: string | null; ends_on: string };
  const boats = (boatData ?? []) as Boat[];
  const boatPrice = typeof boatRate === "number" ? boatRate : 0;
  // Paid per membership: its own fee plus boat storage booked with it.
  const paidFor = new Map<string, number>();
  for (const l of (paidData ?? []) as unknown as { amount_pence: number; membership_id: string | null; boat_storages: { membership_id: string | null } | null }[]) {
    const mid = l.membership_id ?? l.boat_storages?.membership_id;
    if (mid) paidFor.set(mid, (paidFor.get(mid) ?? 0) + l.amount_pence);
  }
  const remindable = new Map(
    ((dueData ?? []) as { person_id: string; last_reminded_at: string | null }[]).map((d) => [d.person_id, d.last_reminded_at]),
  );
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
      // New: their only membership is their first one, and it's running now or starts later.
      isNew: (byPerson.get(p.id) ?? []).length === 1 && (summary.status === "active" || summary.status === "future"),
    };
  });
  // Contacts (email list only, no membership) aren't members, so they aren't listed here.
  const all = everyone.filter((r) => r.status !== "contact");
  const inFilter = (r: (typeof all)[number], f: Filter | "all") => f === "all" || (f === "new" ? r.isNew : r.status === f);
  const inRenewal = (r: (typeof all)[number], f: RenewalFilter | "all") =>
    f === "all" || (f === "outstanding" ? isOutstanding(r.renewal) : r.renewal === f);
  const counts = Object.fromEntries(FILTERS.map((s) => [s, all.filter((r) => inFilter(r, s)).length])) as Record<Filter, number>;
  const RENEWAL_FILTERS: RenewalFilter[] = ["outstanding", ...(Object.keys(RENEWAL_STATUS) as RenewalStatus[])];
  const renewalCounts = Object.fromEntries(RENEWAL_FILTERS.map((s) => [s, all.filter((r) => inRenewal(r, s)).length])) as Record<
    RenewalFilter,
    number
  >;
  const rows = all.filter((r) => inFilter(r, filter) && inRenewal(r, renewalFilter));
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
  // Boats booked with a membership: linked to it, or (for older bookings) stored for the same
  // person or family up to the same end date.
  const boatsFor = (p: (typeof rows)[number], m: Membership) =>
    boats.filter(
      (b) =>
        b.membership_id === m.id ||
        (b.membership_id === null &&
          b.ends_on === m.membership_types?.ends_on &&
          (b.person_id === p.id || (p.household_id !== null && b.household_id === p.household_id))),
    ).length;
  // Money columns, worked out once per membership so a family isn't counted several times.
  // They appear on the first row for that membership (the main contact's, when sorted by name).
  //   Expected - the fee if an outstanding membership is renewed as it is
  //   Boats    - boat storage expected at renewal: boats stored with it x the members rate
  //   Paid     - received for their latest membership (next period's if renewed), boats included
  const moneyShown = new Set<string>();
  const moneyFor = (p: (typeof rows)[number]) => {
    const latest = p.next ?? p.shown;
    if (!latest || moneyShown.has(latest.id)) return null;
    moneyShown.add(latest.id);
    if (p.shown) moneyShown.add(p.shown.id);
    const due = isOutstanding(p.renewal) && p.shown;
    return {
      expected: due ? expectedFee(p.shown) : null,
      boats: due ? boatsFor(p, p.shown!) * boatPrice || null : null,
      paid: paidFor.get(latest.id) ?? null,
    };
  };
  if (sort === "type") {
    // By membership type, then name. People without a membership go last.
    rows.sort((a, b) => {
      const ta = a.shown?.membership_types?.name ?? "￿";
      const tb = b.shown?.membership_types?.name ?? "￿";
      return ta.localeCompare(tb) || a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
    });
  }

  const cashFor = new Map(rows.map((r) => [r.id, moneyFor(r)]));
  const totalOf = (k: "expected" | "boats" | "paid") => [...cashFor.values()].reduce((t, c) => t + (c?.[k] ?? 0), 0);
  const totals = { expected: totalOf("expected"), boats: totalOf("boats"), paid: totalOf("paid") };

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
      <details className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
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
              <li><strong>Due &lt;60d</strong>: membership ends in 31 to {noticeDays} days.</li>
              <li><strong>Due &lt;30d</strong>: membership ends in the next 30 days.</li>
              <li><strong>Due</strong>: membership ended up to 30 days ago.</li>
              <li><strong>Overdue &gt;30d</strong>: ended 31 to 60 days ago.</li>
              <li><strong>Overdue &gt;60d</strong>: ended 61 to {LAPSED_WINDOW_DAYS} days ago.</li>
              <li><strong>Paid</strong>: their next membership is paid.</li>
              <li><strong>–</strong>: none of these (e.g. lapsed more than {LAPSED_WINDOW_DAYS} days ago).</li>
            </ul>
            <p className="mt-2">&ldquo;Outstanding (all)&rdquo; shows every Due and Overdue renewal together.</p>
          </div>
          <div className="sm:col-span-2">
            <h2 className="font-medium text-slate-900">Money columns</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li><strong>Expected</strong>: the membership fee if an outstanding renewal is renewed as it is.</li>
              <li><strong>Boats</strong>: boat storage expected at renewal (boats stored now at the members&apos; rate).</li>
              <li><strong>Paid</strong>: received for their latest membership (next period&apos;s if they&apos;ve renewed), boat storage included.</li>
              <li>
                Each is shown once per membership, on the main contact&apos;s row. The totals at the bottom follow the filters, e.g. Outstanding
                (all) gives the money still to come and Renewal Paid gives renewal income received. <strong>New</strong> shows new members.
              </li>
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
            {s === "all" ? "All" : FILTER_LABEL[s]} ({s === "all" ? all.length : counts[s]})
          </Link>
        ))}
      </nav>
      <nav aria-label="Filter by renewal status" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Renewal:</span>
        {(["all", ...RENEWAL_FILTERS] as (RenewalFilter | "all")[]).map((s) => (
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
            {s === "all" ? "Any" : s === "outstanding" ? "Outstanding (all)" : RENEWAL_STATUS[s]}
            {s !== "all" && ` (${renewalCounts[s]})`}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-slate-600">
        Showing {rows.length} {rows.length === 1 ? "person" : "people"}
        {q && <> matching &ldquo;{q}&rdquo;</>}, sorted by {sort === "type" ? "membership type" : "name"}.
      </p>
      <form id="remind" action="/admin/members/remind" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">To send renewal reminders, tick the members in the Remind column, then press Send reminder.</p>
        <button type="submit" className="rounded border border-slate-400 bg-white px-4 py-2 font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50">
          Send reminder…
        </button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {sortHeader("name", "Name")}
              {sortHeader("type", "Type")}
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Renewal</th>
              <th className="px-3 py-2 text-right font-medium" title="The fee if an outstanding membership is renewed as it is. Shown once per membership.">
                Expected
              </th>
              <th className="px-3 py-2 text-right font-medium" title="Boat storage expected at renewal: boats stored now at the members' rate.">
                Boats
              </th>
              <th className="px-3 py-2 text-right font-medium" title="Received for their latest membership, boat storage included. Shown once per membership.">
                Paid
              </th>
              <th className="px-3 py-2 font-medium" title="Main contacts with a renewal outstanding. Tick to send a renewal reminder.">
                Remind
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => {
              const age = ageOn(p.date_of_birth);
              const m = p.shown;
              const cash = cashFor.get(p.id);
              const isMain = !grouped.has(p.id) && (!p.household_id || p.households?.lead_person_id === p.id || p.households?.lead_person_id == null);
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
                        {isMain && (
                          <span className="text-xs text-slate-400">
                            {" "}
                            {p.status === "active"
                              ? `to ${longDate(m.membership_types?.ends_on)}`
                              : p.status === "future"
                                ? `from ${longDate(m.membership_types?.starts_on)}`
                                : `ended ${month(m.membership_types?.ends_on)}`}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 ${STATUS_STYLE[p.status]}`}>{MEMBERSHIP_STATUS[p.status]}</span>
                    {p.isNew && " "}
                    {p.isNew && <span className="whitespace-nowrap rounded bg-violet-50 px-2 py-0.5 text-violet-900">New</span>}
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
                  <td className="px-3 py-2 text-right whitespace-nowrap">{cash?.expected != null ? money(cash.expected) : ""}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{cash?.boats != null ? money(cash.boats) : ""}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{cash?.paid != null ? money(cash.paid) : ""}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {remindable.has(p.id) && (
                      <label className="flex items-center gap-2">
                        <input type="checkbox" form="remind" name="p" value={p.id} aria-label={`Remind ${p.first_name} ${p.last_name}`} />
                        {remindable.get(p.id) && <span className="text-xs text-slate-500">Reminded {shortDate(remindable.get(p.id)!)}</span>}
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-900">
            <tr>
              <td className="px-3 py-2" colSpan={4}>
                Total ({rows.length} {rows.length === 1 ? "person" : "people"} shown)
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{money(totals.expected)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{money(totals.boats)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{money(totals.paid)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
