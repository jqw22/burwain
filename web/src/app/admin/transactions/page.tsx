import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Notice, SaveButton } from "@/components/fields";
import { LiveSearch } from "@/components/live-search";
import { meWithRole, pounds, ukDate } from "@/lib/me";

type Row = {
  id: string;
  occurred_on: string;
  description: string;
  direction: "in" | "out";
  amount_pence: number;
  method: string | null;
  category: string | null;
  paid_by: string | null;
  is_correction: boolean;
  balance_pence: number;
  seq: number;
};

const METHOD: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  bank_transfer: "Bank transfer",
  card: "Card",
  direct_debit: "Direct Debit",
};

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
// Money with a minus sign when below zero.
// Money always to 2 decimal places, with commas for thousands (£1,234.50).
const money = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (pence: number) => `${pence < 0 ? "−" : ""}${money(Math.abs(pence))}`;

// Today's month in the UK, as first and last day (YYYY-MM-DD).
function thisMonth() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const [y, m] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

// Money in and out between two dates (this month to start with), with a running balance.
// The balance starts at zero before the very first transaction. Finance and admin logins only.
export default async function TransactionsPage({ searchParams }: PageProps<"/admin/transactions">) {
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

  const { data } = await supabase.rpc("club_transactions", { p_from: from, p_to: to });
  const inRange = (data ?? []) as Row[];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (r: Row) => {
    const text = [r.description, r.category, r.paid_by, r.method && METHOD[r.method], ukDate(r.occurred_on), pounds(r.amount_pence), money(r.amount_pence)]
      .join(" ")
      .toLowerCase();
    return words.every((w) => text.includes(w));
  };
  const rows = inRange.filter(matches).sort((a, b) => (order === "asc" ? a.seq - b.seq : b.seq - a.seq));
  const total = (d: "in" | "out") => rows.filter((r) => r.direction === d).reduce((s, r) => s + r.amount_pence, 0);
  const moneyIn = total("in");
  const moneyOut = total("out");

  const href = (change: Record<string, string>) => {
    const next = new URLSearchParams({ from, to, ...(q && { q }), order, ...change });
    if (next.get("order") === "desc") next.delete("order");
    return `/admin/transactions?${next}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Finance</h1>
      <AdminNav current="transactions" />
      <Notice message={params.saved === "added" ? "Transaction added." : undefined} />
      {isFinance && (
        <div className="flex justify-end">
          <Link href="/admin/transactions/new" className="rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-900">
            + Add transaction
          </Link>
        </div>
      )}

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

      <LiveSearch label="Search transactions" placeholder="Search by description, who paid or was paid, category or amount" initial={q} />

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Money in</dt>
          <dd className="text-xl font-semibold">{money(moneyIn)}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Money out</dt>
          <dd className="text-xl font-semibold">{money(moneyOut)}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Difference</dt>
          <dd className="text-xl font-semibold">{signed(moneyIn - moneyOut)}</dd>
        </div>
      </dl>

      <Card title={`Transactions from ${ukDate(from)} to ${ukDate(to)}`}>
        <p className="mb-3 text-sm text-slate-600">
          {rows.length} {rows.length === 1 ? "transaction" : "transactions"}
          {q && <> matching &ldquo;{q}&rdquo;</>}, {order === "asc" ? "oldest" : "newest"} first. The balance starts from £0 before the first
          transaction ever recorded.
        </p>
        {rows.length === 0 ? (
          <p className="text-slate-600">No transactions{q ? " match that search" : " in these dates"}.</p>
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
                  <th className="py-2 pr-4">Description</th>
                  <th className="py-2 pr-4">Paid by / to</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">How paid</th>
                  <th className="py-2 pr-4 text-right">In</th>
                  <th className="py-2 pr-4 text-right">Out</th>
                  <th className="py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap py-2 pr-4">{ukDate(r.occurred_on)}</td>
                    <td className="py-2 pr-4">
                      {r.description}
                      {r.is_correction && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Correction</span>}
                    </td>
                    <td className="py-2 pr-4">{r.paid_by ?? ""}</td>
                    <td className="py-2 pr-4">{r.category ?? "Uncategorised"}</td>
                    <td className="py-2 pr-4">{r.method ? (METHOD[r.method] ?? r.method) : ""}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">{r.direction === "in" ? money(r.amount_pence) : ""}</td>
                    <td className="whitespace-nowrap py-2 pr-4 text-right">{r.direction === "out" ? money(r.amount_pence) : ""}</td>
                    <td className="whitespace-nowrap py-2 text-right">{signed(r.balance_pence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
