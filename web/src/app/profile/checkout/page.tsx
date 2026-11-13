import Link from "next/link";
import { Card, Notice } from "@/components/fields";
import { MAX_BOATS, type Boat } from "@/lib/boats";
import { CheckoutForm } from "./checkout-form";
import { pounds, requireMe } from "@/lib/me";
import { quote, typeDates, ukToday } from "@/lib/quote";
import { payTest } from "./actions";

type Membership = {
  id: string;
  price_pence: number;
  prorata_months: number;
  membership_types: { name: string; starts_on: string; ends_on: string; annual_price_pence: number } | null;
  membership_people: { people: { first_name: string } | null }[];
};

type Storage = {
  id: string;
  boat_class: string | null;
  sail_number: string | null;
  price_pence: number;
  status: string;
  starts_on: string;
  ends_on: string;
};

const METHOD: Record<string, string> = { card: "card", direct_debit: "Direct Debit" };

// Checkout after renewing: what's owed for next year and a Pay button.
// This is a TEST checkout. It doesn't take money, but it records the payment and marks the memberships as paid.
export default async function CheckoutPage({ searchParams }: PageProps<"/profile/checkout">) {
  const params = await searchParams;
  const { supabase, personId } = await requireMe();

  if (typeof params.receipt === "string") {
    const { data: receipt } = await supabase
      .from("member_receipts")
      .select("amount_pence, method")
      .eq("id", params.receipt)
      .maybeSingle<{ amount_pence: number; method: string }>();
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Checkout</h1>
        <Card title="Payment confirmed">
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-3 font-medium text-emerald-900" role="status">
              <span aria-hidden="true">✓</span>
              Thank you.{" "}
              {receipt
                ? `Your payment of ${pounds(receipt.amount_pence)} by ${METHOD[receipt.method] ?? receipt.method} is confirmed.`
                : "Your payment is confirmed."}
            </p>
            <TestNotice />
            <p className="text-sm text-slate-700">Your membership is now paid.</p>
            <Link href="/profile#renew" className="inline-block text-sky-800 underline">
              Back to Member
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const { data: me } = await supabase.from("people").select("household_id").eq("id", personId).single<{ household_id: string | null }>();
  const query = supabase
    .from("memberships")
    .select(
      "id, price_pence, prorata_months, membership_types!inner(name, starts_on, ends_on, annual_price_pence), membership_people(people(first_name))",
    )
    .gte("membership_types.ends_on", ukToday())
    .eq("status", "awaiting_payment")
    .order("created_at");
  const { data } = await (me?.household_id ? query.eq("household_id", me.household_id) : query.eq("payer_person_id", personId));
  const owed = (data ?? []) as unknown as Membership[];

  // Boats: any awaiting payment (e.g. added by an admin), and how many more can be added for the
  // dates of the membership being paid for (the latest one). Last time's boats are suggested.
  const today = ukToday();
  const [{ data: storageData }, { data: boatPrice }] = await Promise.all([
    supabase
      .from("boat_storages")
      .select("id, boat_class, sail_number, price_pence, status, starts_on, ends_on")
      .neq("status", "cancelled")
      .order("created_at"),
    supabase.rpc("boat_storage_price", { p_members: true }),
  ]);
  const storages = (storageData ?? []) as Storage[];
  const unpaidBoats = storages.filter((b) => b.status === "awaiting_payment" && b.ends_on >= today);
  const period = owed
    .map((m) => m.membership_types)
    .filter((t) => t !== null)
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0];
  let maxNew = 0;
  let suggested: Boat[] = [];
  if (period) {
    const inPeriod = storages.filter((b) => b.starts_on <= period.ends_on && b.ends_on >= period.starts_on);
    maxNew = Math.max(0, MAX_BOATS - inPeriod.length);
    const earlier = storages.filter((b) => b.ends_on < period.starts_on).sort((a, b) => b.ends_on.localeCompare(a.ends_on));
    const lastEnd = earlier[0]?.ends_on;
    const taken = new Set(inPeriod.map((b) => b.sail_number));
    suggested = earlier
      .filter((b) => b.ends_on === lastEnd && !taken.has(b.sail_number))
      .map((b) => ({ boat_class: b.boat_class ?? "", sail_number: b.sail_number ?? "" }))
      .slice(0, maxNew);
  }
  const owedTotal = owed.reduce((sum, m) => sum + m.price_pence, 0) + unpaidBoats.reduce((sum, b) => sum + b.price_pence, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      {params.renewed && <Notice message="Renewed. Here's what to pay." />}
      {params.error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {params.error === "boats"
            ? "Please give a class and sail number for each boat (up to 3 per membership)."
            : "Sorry, the payment didn't go through. Please try again, or contact the membership secretary."}
        </p>
      )}
      {owed.length === 0 && unpaidBoats.length === 0 ? (
        <Card title="Nothing to pay">
          <p className="text-slate-700">You don&apos;t have any memberships waiting for payment.</p>
          <Link href="/profile#renew" className="mt-3 inline-block text-sky-800 underline">
            Back to Member
          </Link>
        </Card>
      ) : (
        <CheckoutForm
          action={payTest}
          lines={[
            ...owed.map((m) => ({
              id: m.id,
              kind: "membership" as const,
              title: m.membership_types?.name ?? "",
              detail: [
                m.membership_types ? typeDates(m.membership_types) : "",
                m.membership_people.map((p) => p.people?.first_name).filter(Boolean).join(", ") +
                  (m.membership_types && m.prorata_months < quote(m.membership_types, m.membership_types.starts_on).total
                    ? ` (${m.prorata_months} months)`
                    : ""),
              ],
              pence: m.price_pence,
            })),
            ...unpaidBoats.map((b) => ({
              id: b.id,
              kind: "storage" as const,
              title: "Boat storage",
              detail: [`${b.boat_class ?? ""} ${b.sail_number ?? ""}`.trim(), typeDates(b)],
              pence: b.price_pence,
            })),
          ]}
          baseTotal={owedTotal}
          boatPrice={Number(boatPrice) || 0}
          maxNewBoats={maxNew}
          suggestedBoats={suggested}
        />
      )}
    </div>
  );
}

function TestNotice() {
  return (
    <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <strong>Test checkout.</strong> No money is taken and no card or bank details are asked for, but the payment is recorded
      and your membership is marked as paid. Online payment by card and Direct Debit will be switched on later.
    </p>
  );
}
