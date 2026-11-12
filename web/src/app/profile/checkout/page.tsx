import Link from "next/link";
import { Card, Notice, SaveButton } from "@/components/fields";
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

const METHOD = { card: "card", direct_debit: "Direct Debit" } as const;

// Checkout after renewing: what's owed for next year and a Pay button.
// This is a TEST checkout. It doesn't take money or mark anything as paid.
export default async function CheckoutPage({ searchParams }: PageProps<"/profile/checkout">) {
  const params = await searchParams;
  const { supabase, personId } = await requireMe();

  if (typeof params.paid === "string") {
    const method = params.method === "direct_debit" ? "direct_debit" : "card";
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold">Checkout</h1>
        <Card title="Payment confirmed">
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-3 font-medium text-emerald-900" role="status">
              <span aria-hidden="true">✓</span>
              Thank you. Your payment of {pounds(Number(params.paid) || 0)} by {METHOD[method]} is confirmed.
            </p>
            <TestNotice />
            <p className="text-sm text-slate-700">
              Because this was a test, your membership still shows as <strong>Awaiting payment</strong>. The club&apos;s finance team
              will mark it as paid when they receive your payment.
            </p>
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
  const total = owed.reduce((sum, m) => sum + m.price_pence, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      {params.renewed && <Notice message="Renewed. Here's what to pay." />}
      {owed.length === 0 ? (
        <Card title="Nothing to pay">
          <p className="text-slate-700">You don&apos;t have any memberships waiting for payment.</p>
          <Link href="/profile#renew" className="mt-3 inline-block text-sky-800 underline">
            Back to Member
          </Link>
        </Card>
      ) : (
        <>
          <Card title="Your order">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-slate-100">
                {owed.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 pr-4">
                      <strong>{m.membership_types?.name}</strong>
                      <span className="block text-slate-600">{m.membership_types && typeDates(m.membership_types)}</span>
                      <span className="block text-slate-600">
                        {m.membership_people.map((p) => p.people?.first_name).filter(Boolean).join(", ")}
                        {m.membership_types && m.prorata_months < quote(m.membership_types, m.membership_types.starts_on).total &&
                          ` (${m.prorata_months} months)`}
                      </span>
                    </td>
                    <td className="py-2 text-right">{pounds(m.price_pence)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-2">Total to pay</td>
                  <td className="py-2 text-right">{pounds(total)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>
          <Card title="Payment">
            <form action={payTest} aria-label="Payment" className="space-y-4">
              <TestNotice />
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">How would you like to pay?</legend>
                <label className="flex items-start gap-2 rounded border border-slate-200 p-3">
                  <input type="radio" name="method" value="card" defaultChecked className="mt-1" />
                  <span>
                    <span className="font-medium">Debit or credit card</span>
                    <span className="block text-sm text-slate-600">Pay the full amount now.</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 rounded border border-slate-200 p-3">
                  <input type="radio" name="method" value="direct_debit" className="mt-1" />
                  <span>
                    <span className="font-medium">Direct Debit</span>
                    <span className="block text-sm text-slate-600">Collected from your bank account.</span>
                  </span>
                </label>
              </fieldset>
              <input type="hidden" name="total" value={total} />
              <div className="flex flex-wrap items-center gap-4">
                <SaveButton pendingText="Processing…">Pay {pounds(total)}</SaveButton>
                <Link href="/profile#renew" className="text-sm text-slate-600 underline">
                  Pay later
                </Link>
              </div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}

function TestNotice() {
  return (
    <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <strong>Test checkout.</strong> No money is taken and no card or bank details are asked for. Online payment by card and
      Direct Debit will be switched on later.
    </p>
  );
}
