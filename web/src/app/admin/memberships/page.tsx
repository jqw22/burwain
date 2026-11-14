import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Notice, SaveButton } from "@/components/fields";
import { LiveSearch } from "@/components/live-search";
import { meWithRole, pounds, ukDate } from "@/lib/me";
import { recordPayment } from "./actions";

type Year = { id: string; label: string; starts_on: string };
type Income = {
  id: string;
  paid_on: string;
  payer_name: string | null;
  description: string;
  kind: string;
  covers: string | null;
  method: string | null;
  amount_pence: number;
};
type Row = {
  id: string;
  membership_code: string;
  membership_type: string;
  status: string;
  price_pence: number;
  prorata_months: number;
  payer_name: string;
  people: string | null;
  created_at: string;
  paid_on: string | null;
  method: string | null;
};

const METHOD: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  bank_transfer: "Bank transfer",
  card: "Card",
  direct_debit: "Direct Debit",
};

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
// Money always to 2 decimal places, with commas for thousands (£1,234.50).
const money = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Today's month in the UK, as first and last day (YYYY-MM-DD).
function thisMonth() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}
const SAVED: Record<string, string> = {
  paid: "Payment recorded. Those memberships are now marked as paid.",
};
const ERRORS: Record<string, string> = {
  choose: "Please tick at least one membership to mark as paid.",
  payment: "We couldn't record that payment. Check the date isn't in the future and the memberships are still awaiting payment.",
  finance: "Only finance logins can record payments.",
};

// Income: every payment received from members (memberships and boat storage) in one list, between
// two dates (this month to start with), with search and date sort like Transactions. Below it,
// memberships still awaiting payment, which finance can mark as paid (bank transfer, cheque, cash).
export default async function IncomePage({ searchParams }: PageProps<"/admin/memberships">) {
  const params = await searchParams;
  const { supabase, allowed: isAdmin } = await meWithRole("admin");
  const { data: financeRole } = await supabase.rpc("has_role", { r: "finance" });
  const isFinance = Boolean(financeRole);
  if (!isAdmin && !isFinance) return <NotAllowed who="club admins and finance" />;

  const month = thisMonth();
  let from = isDate(params.from) ? params.from : month.from;
  let to = isDate(params.to) ? params.to : month.to;
  if (from > to) [from, to] = [to, from];
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const order = params.order === "asc" ? "asc" : "desc";

  const [{ data: incomeData }, { data: yearsData }] = await Promise.all([
    supabase.rpc("member_income", { p_from: from, p_to: to }),
    supabase.from("club_years").select("id, label, starts_on").order("starts_on"),
  ]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (r: Income) => {
    const text = [r.payer_name, r.description, r.kind, r.covers, r.method && METHOD[r.method], ukDate(r.paid_on), pounds(r.amount_pence), money(r.amount_pence)]
      .join(" ")
      .toLowerCase();
    return words.every((w) => text.includes(w));
  };
  const all = (incomeData ?? []) as Income[];
  const rows = all.filter(matches);
  if (order === "desc") rows.reverse();
  const sumOf = (list: Income[]) => list.reduce((s, r) => s + r.amount_pence, 0);
  const memberships = sumOf(rows.filter((r) => r.kind === "Membership"));
  const boats = sumOf(rows.filter((r) => r.kind === "Boat storage"));
  const total = sumOf(rows);

  // Awaiting payment, for every membership year.
  const years = (yearsData ?? []) as Year[];
  const lists = await Promise.all(years.map((y) => supabase.rpc("club_memberships", { p_club_year_id: y.id })));
  const unpaid = lists.flatMap((l) => ((l.data ?? []) as Row[]).filter((r) => r.status === "awaiting_payment"));

  const saved = typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

  const href = (change: Record<string, string>) => {
    const next = new URLSearchParams({ from, to, ...(q && { q }), order, ...change });
    if (next.get("order") === "desc") next.delete("order");
    return `/admin/memberships?${next}`;
  };

  return (
    <div className="space-y-6">
      <AdminNav current="memberships" />
      <Notice message={saved} />
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}

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
        {order === "asc" && <input type="hidden" name="order" value="asc" />}
        <SaveButton variant="secondary">Show</SaveButton>
        {(from !== month.from || to !== month.to) && (
          <Link href={href({ from: month.from, to: month.to })} className="py-2 text-sm text-sky-800 underline">
            This month
          </Link>
        )}
      </form>

      <LiveSearch label="Search income" placeholder="Search by who paid, membership, boat, how paid or amount" initial={q} />

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Memberships</dt>
          <dd className="text-xl font-semibold">{money(memberships)}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Boat storage</dt>
          <dd className="text-xl font-semibold">{money(boats)}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Total received</dt>
          <dd className="text-xl font-semibold">{money(total)}</dd>
        </div>
      </dl>

      <Card title={`Payments received from ${ukDate(from)} to ${ukDate(to)}`}>
        <p className="mb-3 text-sm text-slate-600">
          {rows.length} {rows.length === 1 ? "payment" : "payments"}
          {q && <> matching &ldquo;{q}&rdquo;</>}, {order === "asc" ? "oldest" : "newest"} first. These are what members paid; the bank
          receipts are entered separately under Transactions.
        </p>
        {rows.length === 0 ? (
          <p className="text-slate-600">No payments{q ? " match that search" : " in these dates"}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="py-2 pr-4" aria-sort={order === "asc" ? "ascending" : "descending"}>
                    <Link
                      href={href({ order: order === "asc" ? "desc" : "asc" })}
                      className="font-semibold text-sky-900 underline"
                      title={order === "asc" ? "Show newest first" : "Show oldest first"}
                    >
                      Date<span aria-hidden="true"> {order === "asc" ? "▲" : "▼"}</span>
                    </Link>
                  </th>
                  <th className="py-2 pr-4">Paid by</th>
                  <th className="py-2 pr-4">For</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">How paid</th>
                  <th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap py-2 pr-4">{ukDate(r.paid_on)}</td>
                    <td className="py-2 pr-4">{r.payer_name ?? ""}</td>
                    <td className="py-2 pr-4">
                      {r.description}
                      {r.covers && <span className="block text-xs text-slate-500">{r.covers}</span>}
                    </td>
                    <td className="py-2 pr-4">{r.kind}</td>
                    <td className="py-2 pr-4">{r.method ? (METHOD[r.method] ?? r.method) : ""}</td>
                    <td className="whitespace-nowrap py-2 text-right">{money(r.amount_pence)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 font-semibold">
                <tr>
                  <td className="py-2 pr-4" colSpan={5}>
                    Total
                  </td>
                  <td className="whitespace-nowrap py-2 text-right">{money(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title="Awaiting payment">
        {unpaid.length === 0 ? (
          <p className="text-slate-600">No memberships are awaiting payment.</p>
        ) : (
          <form action={recordPayment} className="space-y-4">
            <p className="text-sm text-slate-600">
              {unpaid.length} {unpaid.length === 1 ? "membership" : "memberships"} ({money(unpaid.reduce((s, r) => s + r.price_pence, 0))}).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-600">
                  <tr>
                    {isFinance && <th className="py-2 pr-2"><span className="sr-only">Select</span></th>}
                    <th className="py-2 pr-4">Paid by</th>
                    <th className="py-2 pr-4">Membership</th>
                    <th className="py-2 pr-4">Covers</th>
                    <th className="py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {unpaid.map((r) => (
                    <tr key={r.id}>
                      {isFinance && (
                        <td className="py-2 pr-2">
                          <input type="checkbox" name="membership_id" value={r.id} aria-label={`Mark ${r.membership_type} for ${r.people} as paid`} />
                        </td>
                      )}
                      <td className="py-2 pr-4">{r.payer_name}</td>
                      <td className="py-2 pr-4">
                        {r.membership_type} <span className="text-slate-500">({r.membership_code})</span>
                      </td>
                      <td className="py-2 pr-4">{r.people}</td>
                      <td className="whitespace-nowrap py-2 text-right">
                        {money(r.price_pence)}
                        {r.prorata_months < 12 && <span className="text-slate-500"> ({r.prorata_months} months)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isFinance ? (
              <fieldset className="space-y-3 rounded border border-slate-200 p-4">
                <legend className="px-1 font-medium">Record a payment for the ticked memberships</legend>
                <div className="flex flex-wrap items-end gap-4">
                  <label className="block">
                    <span className="text-sm font-medium">Paid by</span>
                    <select name="method" required className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2">
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="cash">Cash</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Date received</span>
                    <input
                      type="date"
                      name="paid_on"
                      required
                      max={today}
                      defaultValue={today}
                      className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2"
                    />
                  </label>
                  <SaveButton pendingText="Recording…">Record payment</SaveButton>
                </div>
                <p className="text-xs text-slate-500">
                  Card and Direct Debit payments will be recorded automatically once online payments are switched on.
                </p>
              </fieldset>
            ) : (
              <p className="text-sm text-slate-600">Payments are recorded by the finance logins.</p>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}
