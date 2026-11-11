import Link from "next/link";
import { STATUS_LABEL } from "@/components/admin";
import { SaveButton } from "@/components/fields";
import { ageOn, pounds } from "@/lib/me";
import type { createClient } from "@/lib/supabase/server";
import { renewMemberships } from "./actions";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Year = { id: string; label: string; starts_on: string; ends_on: string; is_renewal: boolean };
type MembershipType = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: "sailing" | "non_sailing";
  cover: "individual" | "dual" | "family" | "junior";
  annual_price_pence: number;
  max_age: number | null;
  sibling_order: number | null;
  is_open: boolean;
};
type Membership = {
  id: string;
  club_year_id: string;
  status: string;
  price_pence: number;
  prorata_months: number;
  membership_types: MembershipType | null;
  membership_people: { person_id: string }[];
};
type Member = { id: string; first_name: string; last_name: string; date_of_birth: string | null };

const RENEWABLE = ["active", "awaiting_payment", "pending_approval"];

// "Your membership" on Your details: this year's memberships, and renewing for next year once renewals open.
// Members can only renew what they have. Joining or changing type is done by club admins.
export async function RenewalCard({
  supabase,
  personId,
  householdId,
  canRenew,
  family,
  messages,
}: {
  supabase: Supabase;
  personId: string;
  householdId: string | null;
  canRenew: boolean;
  family: Member[];
  messages: React.ReactNode;
}) {
  const { data: yearsData } = await supabase.rpc("open_club_years");
  const years = (yearsData ?? []) as Year[];
  const current = years.find((y) => !y.is_renewal);
  const next = years.find((y) => y.is_renewal);

  const query = supabase
    .from("memberships")
    .select(
      "id, club_year_id, status, price_pence, prorata_months, membership_types(id, code, name, description, category, cover, annual_price_pence, max_age, sibling_order, is_open), membership_people(person_id)",
    )
    .in("club_year_id", years.map((y) => y.id))
    .neq("status", "cancelled")
    .order("created_at");
  const { data: membershipsData } = await (householdId ? query.eq("household_id", householdId) : query.eq("payer_person_id", personId));
  const memberships = (membershipsData ?? []) as unknown as Membership[];
  const people = family.length > 0 ? family : [];
  const nameOf = (id: string) => people.find((p) => p.id === id)?.first_name ?? "you";
  // Oldest first, matching the family list.
  const order = (id: string) => people.findIndex((p) => p.id === id);
  const names = (m: Membership) =>
    m.membership_people
      .map((p) => p.person_id)
      .sort((a, b) => order(a) - order(b))
      .map(nameOf)
      .join(", ");

  const thisYear = memberships.filter((m) => m.club_year_id === current?.id);
  const nextYear = memberships.filter((m) => m.club_year_id === next?.id);
  const coveredNext = new Set(nextYear.flatMap((m) => m.membership_people.map((p) => p.person_id)));

  // What to renew: this year's memberships whose people aren't sorted for next year yet.
  // Adults first, because a junior needs an adult member in the family.
  const toRenew = next
    ? thisYear
        .filter((m) => RENEWABLE.includes(m.status) && m.membership_types)
        .filter((m) => m.membership_people.some((p) => !coveredNext.has(p.person_id)))
        .sort((a, b) => Number(a.membership_types!.cover === "junior") - Number(b.membership_types!.cover === "junior"))
    : [];
  const problem = (m: Membership) => {
    const t = m.membership_types!;
    if (!t.is_open) return `${t.name} isn't offered for ${next!.label}.`;
    if (t.max_age !== null) {
      const over = m.membership_people.find((p) => {
        const dob = people.find((x) => x.id === p.person_id)?.date_of_birth ?? null;
        const age = ageOn(dob, new Date(next!.starts_on));
        return age === null || age > t.max_age!;
      });
      if (over) return `${nameOf(over.person_id)} will be too old for ${t.name} in ${next!.label} (or their date of birth is missing).`;
    }
    return null;
  };
  const ready = toRenew.filter((m) => !problem(m));
  const blocked = toRenew.filter((m) => problem(m));

  const status = (s: string) => (
    <span
      className={
        s === "active"
          ? "ml-2 rounded bg-emerald-50 px-2 py-0.5 text-sm text-emerald-900"
          : "ml-2 rounded bg-amber-50 px-2 py-0.5 text-sm text-amber-900"
      }
    >
      {STATUS_LABEL[s] ?? s}
    </span>
  );
  const line = (m: Membership) => (
    <li key={m.id}>
      <strong>{m.membership_types?.name}</strong> for {names(m)}: {pounds(m.price_pence)}
      {m.prorata_months < 12 && <span className="text-sm text-slate-500"> ({m.prorata_months} months)</span>}
      {status(m.status)}
    </li>
  );

  return (
    <section id="renew" aria-label="Your membership" className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">Your membership</h2>
      </div>
      <div className="mt-4 space-y-4">
        {messages}
        {current && (
          <div>
            <h3 className="font-medium">{current.label}</h3>
            {thisYear.length === 0 ? (
              <p className="text-slate-700">
                No membership for {current.label}. To join or rejoin, please contact the membership secretary.
              </p>
            ) : (
              <ul className="mt-1 space-y-1">{thisYear.map(line)}</ul>
            )}
          </div>
        )}

        {next && (
          <div className="rounded border border-sky-200 bg-sky-50 p-4">
            <h3 className="font-medium text-sky-950">Renew for {next.label}</h3>
            {nextYear.length > 0 && (
              <ul className="mt-2 space-y-1">{nextYear.map(line)}</ul>
            )}
            {canRenew && nextYear.some((m) => m.status === "awaiting_payment") && (
              <Link
                href="/profile/checkout"
                className="mt-3 inline-block rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-900"
              >
                Pay now
              </Link>
            )}
            {!canRenew ? (
              <p className="mt-2 text-slate-700">Your family&apos;s main contact renews for everyone.</p>
            ) : toRenew.length === 0 ? (
              nextYear.length === 0 && (
                <p className="mt-2 text-slate-700">There&apos;s nothing from {current?.label ?? "this year"} to renew.</p>
              )
            ) : (
              <>
                {ready.length > 0 && (
                  <form action={renewMemberships} className="mt-2 space-y-3">
                    <p className="text-slate-700">Renew the same memberships for {next.label}, full year:</p>
                    <ul className="space-y-1">
                      {ready.map((m) => (
                        <li key={m.id}>
                          <strong>{m.membership_types!.cover === "junior" ? "Junior" : m.membership_types!.name}</strong> for{" "}
                          {names(m)}: {pounds(m.membership_types!.annual_price_pence)}
                          <input type="hidden" name="renew" value={m.id} />
                        </li>
                      ))}
                    </ul>
                    <input type="hidden" name="club_year_id" value={next.id} />
                    <label className="flex items-start gap-2 rounded border border-sky-300 bg-white p-3">
                      <input name="confirm" type="checkbox" required className="mt-1" />
                      <span className="text-sm">
                        I confirm that all my personal details{people.length > 1 && " (and my family's)"} are up to date.
                      </span>
                    </label>
                    <SaveButton pendingText="Renewing…">Renew for {next.label}</SaveButton>
                  </form>
                )}
                {blocked.length > 0 && (
                  <ul className="mt-3 space-y-1 text-amber-900">
                    {blocked.map((m) => (
                      <li key={m.id}>
                        {problem(m)} Please contact the membership secretary to change it.
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

          </div>
        )}
      </div>
    </section>
  );
}
