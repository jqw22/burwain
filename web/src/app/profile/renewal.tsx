import Link from "next/link";
import { STATUS_LABEL } from "@/components/admin";
import { ageOn, pounds } from "@/lib/me";
import type { createClient } from "@/lib/supabase/server";
import { RenewForm, type RenewPerson, type RenewType } from "./renew-form";

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
// Members renew the people on this year's memberships into any of next year's types.
// Adding people who weren't members this year is done by club admins.
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

  // Who can be renewed: people on this year's memberships who aren't covered for next year yet.
  // Members choose any of next year's active types for them (upgrade or downgrade).
  const pool = next
    ? [...new Set(
        thisYear
          .filter((m) => RENEWABLE.includes(m.status))
          .flatMap((m) => m.membership_people.map((p) => p.person_id))
          .filter((id) => !coveredNext.has(id) && (people.length === 0 || people.some((p) => p.id === id))),
      )].sort((a, b) => order(a) - order(b))
    : [];
  const { data: typesData } = next
    ? await supabase
        .from("membership_types")
        .select("id, code, name, description, cover, annual_price_pence, max_age, sibling_order")
        .eq("club_year_id", next.id)
        .eq("is_open", true)
        .order("sort_order")
    : { data: [] };
  const nextTypes = ((typesData ?? []) as (RenewType & { code: string; sibling_order: number | null })[])
    // Juniors are offered once; the second and third sibling prices are picked automatically.
    .filter((t) => t.sibling_order === null || t.sibling_order === 1);
  // Start with the same type as this year, where next year has it.
  const first = thisYear.find((m) => m.membership_people.some((p) => pool.includes(p.person_id)))?.membership_types;
  const suggested = (
    nextTypes.find((t) => t.code === first?.code) ?? (first?.cover === "junior" ? nextTypes.find((t) => t.cover === "junior") : undefined)
  )?.id;
  const renewPeople: RenewPerson[] = pool.map((id) => {
    const person = people.find((p) => p.id === id);
    return {
      id,
      name: person ? `${person.first_name} ${person.last_name}` : "You",
      age: ageOn(person?.date_of_birth ?? null, new Date(next!.starts_on)),
    };
  });

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
            ) : pool.length === 0 ? (
              nextYear.length === 0 && (
                <p className="mt-2 text-slate-700">There&apos;s nothing from {current?.label ?? "this year"} to renew.</p>
              )
            ) : (
              <>
                {nextYear.length > 0 && <p className="mt-3 font-medium text-sky-950">Renew the others</p>}
                <RenewForm yearId={next.id} yearLabel={next.label} people={renewPeople} types={nextTypes} suggested={suggested} />
                <p className="mt-2 text-sm text-slate-600">
                  To add someone who wasn&apos;t a member this year, please contact the membership secretary.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
