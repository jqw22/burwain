import Link from "next/link";
import { STATUS_LABEL } from "@/components/admin";
import { pounds, ukDate } from "@/lib/me";
import { quote, typeDates, ukToday } from "@/lib/quote";
import type { createClient } from "@/lib/supabase/server";
import { RenewForm, type RenewPerson, type RenewType } from "./renew-form";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type MembershipType = {
  id: string;
  code: string;
  name: string;
  cover: "individual" | "dual" | "family" | "junior";
  annual_price_pence: number;
  starts_on: string;
  ends_on: string;
};
type Membership = {
  id: string;
  status: string;
  price_pence: number;
  prorata_months: number;
  membership_types: MembershipType | null;
  membership_people: { person_id: string }[];
};
type Boat = { id: string; boat_class: string | null; sail_number: string | null; price_pence: number; status: string; starts_on: string; ends_on: string };
type Due = { person_id: string; membership_id: string; code: string; ends_on: string; renewed: boolean };
type Member = { id: string; first_name: string; last_name: string; date_of_birth: string | null };

// "Your membership" on Your details: memberships that haven't ended, and renewing from 60 days before one ends.
// Members renew the people on their memberships into any active type that starts after today.
// Adding people who weren't members is done by club admins.
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
  const today = ukToday();
  const query = supabase
    .from("memberships")
    .select(
      "id, status, price_pence, prorata_months, membership_types!inner(id, code, name, cover, annual_price_pence, starts_on, ends_on), membership_people(person_id)",
    )
    .gte("membership_types.ends_on", today)
    .neq("status", "cancelled")
    .order("created_at");
  const [{ data: membershipsData }, { data: dueData }, { data: boatData }] = await Promise.all([
    householdId ? query.eq("household_id", householdId) : query.eq("payer_person_id", personId),
    supabase.rpc("my_renewals"),
    // The household's boats stored now or later (the page only shows the family's own).
    supabase
      .from("boat_storages")
      .select("id, boat_class, sail_number, price_pence, status, starts_on, ends_on")
      .neq("status", "cancelled")
      .gte("ends_on", today)
      .order("starts_on")
      .order("created_at"),
  ]);
  const boats = (boatData ?? []) as Boat[];
  const memberships = ((membershipsData ?? []) as unknown as Membership[]).sort((a, b) =>
    a.membership_types!.starts_on.localeCompare(b.membership_types!.starts_on),
  );
  const due = (dueData ?? []) as Due[];
  const people = family;
  const nameOf = (id: string) => people.find((p) => p.id === id)?.first_name ?? "you";
  // Oldest first, matching the family list.
  const order = (id: string) => people.findIndex((p) => p.id === id);
  const names = (m: Membership) =>
    m.membership_people
      .map((p) => p.person_id)
      .sort((a, b) => order(a) - order(b))
      .map(nameOf)
      .join(", ");

  const running = memberships.filter((m) => m.membership_types!.starts_on <= today);
  const later = memberships.filter((m) => m.membership_types!.starts_on > today);

  // Who can be renewed: people on a membership ending within 60 days, not renewed yet.
  const pool = [
    ...new Set(due.filter((d) => !d.renewed && (people.length === 0 || people.some((p) => p.id === d.person_id))).map((d) => d.person_id)),
  ].sort((a, b) => order(a) - order(b));
  const renewing = due.length > 0;
  const { data: typesData } = renewing
    ? await supabase
        .from("membership_types")
        .select("id, code, name, description, cover, annual_price_pence, max_age, sibling_order, starts_on, ends_on")
        .eq("is_open", true)
        .gt("starts_on", today)
        .order("starts_on")
        .order("sort_order")
    : { data: [] };
  const types = ((typesData ?? []) as (RenewType & { code: string; sibling_order: number | null })[])
    // Juniors are offered once; the second and third sibling prices are picked automatically.
    .filter((t) => t.sibling_order === null || t.sibling_order === 1);
  // Start with the same type as the membership being renewed.
  const first = due.find((d) => pool.includes(d.person_id));
  const firstType = memberships.find((m) => m.id === first?.membership_id)?.membership_types;
  const suggested = (
    types.find((t) => t.code === first?.code) ?? (firstType?.cover === "junior" ? types.find((t) => t.cover === "junior") : undefined)
  )?.id;
  const renewPeople: RenewPerson[] = pool.map((id) => {
    const person = people.find((p) => p.id === id);
    return { id, name: person ? `${person.first_name} ${person.last_name}` : "You", date_of_birth: person?.date_of_birth ?? null };
  });
  const endsOn = due.map((d) => d.ends_on).sort()[0];

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
  const line = (m: Membership) => {
    const t = m.membership_types!;
    const total = quote(t, t.starts_on).total;
    return (
      <li key={m.id}>
        <strong>{t.name}</strong> for {names(m)}: {pounds(m.price_pence)}
        {m.prorata_months < total && <span className="text-sm text-slate-500"> ({m.prorata_months} months)</span>}
        {status(m.status)}
        <span className="block text-sm text-slate-600">{typeDates(t)}</span>
      </li>
    );
  };

  // A new member accepted from the public join form, or anyone renewed by an admin, pays here too.
  const payNow = (
    <Link href="/profile/checkout" className="mt-3 inline-block rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-900">
      Pay now
    </Link>
  );

  return (
    <section id="renew" aria-label="Your membership" className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">Your membership</h2>
      </div>
      <div className="mt-4 space-y-4">
        {messages}
        {running.length === 0 && later.length === 0 && (
          <p className="text-slate-700">No current membership. To join or rejoin, please contact the membership secretary.</p>
        )}
        {running.length > 0 && <ul className="space-y-2">{running.map(line)}</ul>}
        {canRenew && running.some((m) => m.status === "awaiting_payment") && !later.some((m) => m.status === "awaiting_payment") && payNow}

        {(renewing || later.length > 0) && (
          <div className="rounded border border-sky-200 bg-sky-50 p-4">
            <h3 className="font-medium text-sky-950">{renewing ? "Renew your membership" : "Starting later"}</h3>
            {renewing && endsOn && (
              <p className="mt-1 text-sm text-sky-950">
                {pool.length > 0 ? `Your membership ends on ${ukDate(endsOn)}.` : "Everyone due for renewal has been renewed."}
              </p>
            )}
            {later.length > 0 && <ul className="mt-2 space-y-2">{later.map(line)}</ul>}
            {canRenew && later.some((m) => m.status === "awaiting_payment") && payNow}
            {renewing &&
              pool.length > 0 &&
              (!canRenew ? (
                <p className="mt-2 text-slate-700">Your family&apos;s main contact renews for everyone.</p>
              ) : types.length === 0 ? (
                <p className="mt-2 text-slate-700">
                  The membership types to renew onto aren&apos;t ready yet. You&apos;ll be able to renew here once they are.
                </p>
              ) : (
                <>
                  {later.length > 0 && <p className="mt-3 font-medium text-sky-950">Renew the others</p>}
                  <RenewForm people={renewPeople} types={types} suggested={suggested} />
                  <p className="mt-2 text-sm text-slate-600">
                    To add someone who isn&apos;t a member yet, please contact the membership secretary.
                  </p>
                </>
              ))}
          </div>
        )}
        {boats.length > 0 && (
          <div>
            <h3 className="font-medium">Boat storage</h3>
            <ul className="mt-2 space-y-2">
              {boats.map((b) => (
                <li key={b.id}>
                  <strong>
                    {b.boat_class} {b.sail_number}
                  </strong>
                  : {pounds(b.price_pence)}
                  {status(b.status)}
                  <span className="block text-sm text-slate-600">{typeDates(b)}</span>
                </li>
              ))}
            </ul>
            {canRenew && boats.some((b) => b.status === "awaiting_payment") && !memberships.some((m) => m.status === "awaiting_payment") && payNow}
          </div>
        )}
      </div>
    </section>
  );
}
