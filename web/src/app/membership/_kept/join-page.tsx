// Kept for a future self-join process. Not a live page: folders starting with _ aren't routed.
import { Card, Notice, SaveButton } from "@/components/fields";
import { requireMe } from "@/lib/me";
import { cancelMembership, chooseMembership } from "./actions";

type Year = { id: string; label: string; starts_on: string; ends_on: string; is_renewal: boolean };
type MembershipType = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: "sailing" | "non_sailing";
  cover: "individual" | "dual" | "family" | "junior";
  annual_price_pence: number;
  sibling_order: number | null;
  requires_approval: boolean;
};
type Member = { id: string; first_name: string; last_name: string };
type Membership = {
  id: string;
  club_year_id: string;
  status: string;
  price_pence: number;
  prorata_months: number;
  payer_person_id: string;
  membership_types: { name: string } | null;
  membership_people: { person_id: string }[];
};

const STATUS: Record<string, string> = {
  active: "Paid",
  awaiting_payment: "Awaiting payment",
  pending_approval: "Awaiting committee approval",
  lapsed: "Lapsed",
};
const SAVED: Record<string, string> = {
  added: "Membership added. It's shown below with the amount to pay.",
  cancelled: "Membership cancelled.",
};
const ERRORS: Record<string, string> = {
  type: "Please choose a membership type.",
  who: "Please tick who the membership is for.",
  household: "You can only choose people in your own family.",
  one: "That membership covers one person. Please tick just one name.",
  two: "Dual membership covers two adults. Please tick exactly two names.",
  age: "Someone is over the age limit for that membership, or their date of birth is missing. You can add it on the Family page.",
  adult: "A junior needs an adult in the family with a membership for the same year. Please add the adult membership first.",
  duplicate: "Someone you ticked already has that kind of membership for the year.",
  closed: "That year isn't open for renewals yet.",
  unavailable: "That membership type isn't available at the moment.",
  cancel: "We couldn't cancel that membership. Paid memberships can only be changed by the membership secretary.",
  general: "Something went wrong. Please try again, or contact the membership secretary.",
};

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}

function ukDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default async function MembershipPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const { supabase, personId } = await requireMe();

  const [{ data: yearsData }, { data: typesData }, { data: meRow }] = await Promise.all([
    supabase.rpc("open_club_years"),
    supabase.from("membership_types").select("*").eq("is_open", true).order("sort_order"),
    supabase.from("people").select("household_id").eq("id", personId).single<{ household_id: string | null }>(),
  ]);
  const years = (yearsData ?? []) as Year[];
  // J2/J3 are applied automatically, so members only see "Junior".
  const types = ((typesData ?? []) as MembershipType[]).filter((t) => !t.sibling_order || t.sibling_order === 1);

  const membersQuery = supabase.from("people").select("id, first_name, last_name").is("archived_at", null).order("date_of_birth");
  const [{ data: membersData }, { data: membershipsData }, ...quotes] = await Promise.all([
    meRow?.household_id ? membersQuery.eq("household_id", meRow.household_id) : membersQuery.eq("id", personId),
    // Only this family's memberships (admins could otherwise see everyone's here).
    (() => {
      const q = supabase
        .from("memberships")
        .select("id, club_year_id, status, price_pence, prorata_months, payer_person_id, membership_types(name), membership_people(person_id)")
        .in("club_year_id", years.map((y) => y.id))
        .neq("status", "cancelled")
        .order("created_at");
      return meRow?.household_id ? q.eq("household_id", meRow.household_id) : q.eq("payer_person_id", personId);
    })(),
    ...years.map((y) => supabase.rpc("membership_quote", { p_type_id: types[0]?.id, p_club_year_id: y.id })),
  ]);
  const members = (membersData ?? []) as Member[];
  const memberships = (membershipsData ?? []) as unknown as Membership[];
  const nameOf = (id: string) => members.find((m) => m.id === id)?.first_name ?? "Someone";

  const saved = typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Membership</h1>
      <Notice message={saved} />
      {error && (
        <p className="rounded bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}

      {years.length === 0 && (
        <Card title="Not open yet">
          <p className="text-slate-700">There&apos;s no club year open for membership at the moment.</p>
        </Card>
      )}

      {years.map((year, i) => {
        const months = (quotes[i]?.data as { months: number }[] | null)?.[0]?.months ?? 12;
        const price = (t: MembershipType) => Math.round((t.annual_price_pence * months) / 12);
        const mine = memberships.filter((m) => m.club_year_id === year.id);
        const due = mine.filter((m) => m.status === "awaiting_payment").reduce((sum, m) => sum + m.price_pence, 0);

        return (
          <section key={year.id} className="space-y-4" aria-label={`Club year ${year.label}`}>
            <h2 className="text-xl font-semibold">
              {year.label}
              <span className="ml-2 text-base font-normal text-slate-600">
                {ukDate(year.starts_on)} to {ukDate(year.ends_on)}
              </span>
            </h2>
            {year.is_renewal && (
              <p className="rounded bg-sky-50 p-3 text-sky-900">
                Renewals for {year.label} are open. Renewing before {ukDate(year.starts_on)} is full price for the whole year.
              </p>
            )}

            <Card title="Your family's memberships">
              {mine.length === 0 ? (
                <p className="text-slate-600">None yet for {year.label}.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {mine.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        <strong>{m.membership_types?.name}</strong> for{" "}
                        {m.membership_people.map((p) => nameOf(p.person_id)).join(", ")}: {pounds(m.price_pence)}
                        {m.prorata_months < 12 && <span className="text-sm text-slate-500"> ({m.prorata_months} months)</span>}
                        <span className="ml-2 text-sm text-slate-600">{STATUS[m.status] ?? m.status}</span>
                      </span>
                      {m.payer_person_id === personId && ["awaiting_payment", "pending_approval"].includes(m.status) && (
                        <form action={cancelMembership}>
                          <input type="hidden" name="id" value={m.id} />
                          <SaveButton variant="link" pendingText="Cancelling…">
                            Cancel
                          </SaveButton>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {due > 0 && (
                <p className="mt-4 font-medium">
                  To pay: {pounds(due)}.{" "}
                  <span className="font-normal text-slate-600">
                    Paying online by card or Direct Debit is coming soon.
                  </span>
                </p>
              )}
            </Card>

            <Card title={year.is_renewal ? `Renew for ${year.label}` : `Join or add a membership for ${year.label}`}>
              {months < 12 && (
                <p className="mb-4 text-slate-700">
                  You&apos;re joining part-way through the year, so prices below are for the remaining {months} month
                  {months === 1 ? "" : "s"}.
                </p>
              )}
              <form action={chooseMembership} className="space-y-6">
                <input type="hidden" name="club_year_id" value={year.id} />
                {(["sailing", "non_sailing"] as const).map((category) => (
                  <fieldset key={category}>
                    <legend className="font-medium">{category === "sailing" ? "Sailing" : "Non-sailing and other activities"}</legend>
                    <div className="mt-2 space-y-2">
                      {types
                        .filter((t) => t.category === category)
                        .map((t) => (
                          <label key={t.id} className="flex items-start gap-3 rounded border border-slate-200 p-3 hover:bg-slate-50">
                            <input type="radio" name="type_id" value={t.id} required className="mt-1" />
                            <span>
                              <span className="font-medium">
                                {t.cover === "junior" ? "Junior" : t.name}: {pounds(price(t))}
                              </span>
                              <span className="block text-sm text-slate-600">
                                {t.cover === "junior"
                                  ? "Under 18; a parent must also be a member. A second junior in the family pays less, and a third less again: we work this out for you."
                                  : t.description}
                              </span>
                            </span>
                          </label>
                        ))}
                    </div>
                  </fieldset>
                ))}

                <fieldset>
                  <legend className="font-medium">Who is it for?</legend>
                  <p className="text-sm text-slate-600">Tick everyone the membership covers. For Family, tick the whole family.</p>
                  <div className="mt-2 flex flex-wrap gap-4">
                    {members.map((m) => (
                      <label key={m.id} className="flex items-center gap-2">
                        <input type="checkbox" name="person_id" value={m.id} defaultChecked={m.id === personId} />
                        {m.first_name} {m.last_name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <SaveButton>Add membership</SaveButton>
              </form>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
