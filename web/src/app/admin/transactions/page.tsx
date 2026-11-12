import { AdminNav, NotAllowed } from "@/components/admin";
import { Card } from "@/components/fields";
import { meWithRole, pounds, ukDate } from "@/lib/me";

type Row = {
  id: string;
  occurred_on: string;
  description: string;
  direction: "in" | "out";
  amount_pence: number;
  method: string | null;
  reverses_id: string | null;
  category: { name: string } | null;
};

const METHOD: Record<string, string> = {
  cash: "Cash",
  cheque: "Cheque",
  bank_transfer: "Bank transfer",
  card: "Card",
  direct_debit: "Direct Debit",
};

// Every money-in and money-out record, newest first. Finance and admin logins only.
export default async function TransactionsPage() {
  const { supabase, allowed: isAdmin } = await meWithRole("admin");
  const { data: financeRole } = await supabase.rpc("has_role", { r: "finance" });
  if (!isAdmin && !financeRole) return <NotAllowed who="club admins and finance" />;

  const { data } = await supabase
    .from("transactions")
    .select("id, occurred_on, description, direction, amount_pence, method, reverses_id, category:transaction_categories(name)")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];
  const total = (d: "in" | "out") => rows.filter((r) => r.direction === d).reduce((s, r) => s + r.amount_pence, 0);
  const moneyIn = total("in");
  const moneyOut = total("out");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Transactions</h1>
      <AdminNav current="transactions" />

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Money in</dt>
          <dd className="text-xl font-semibold">{pounds(moneyIn)}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Money out</dt>
          <dd className="text-xl font-semibold">{pounds(moneyOut)}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Difference</dt>
          <dd className="text-xl font-semibold">
            {moneyIn < moneyOut ? "−" : ""}
            {pounds(Math.abs(moneyIn - moneyOut))}
          </dd>
        </div>
      </dl>

      <Card title="All transactions, newest first">
        {rows.length === 0 ? (
          <p className="text-slate-600">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Description</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Paid by</th>
                  <th className="py-2 pr-4 text-right">In</th>
                  <th className="py-2 text-right">Out</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="whitespace-nowrap py-2 pr-4">{ukDate(r.occurred_on)}</td>
                    <td className="py-2 pr-4">
                      {r.description}
                      {r.reverses_id && <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">Correction</span>}
                    </td>
                    <td className="py-2 pr-4">{r.category?.name ?? "Uncategorised"}</td>
                    <td className="py-2 pr-4">{r.method ? METHOD[r.method] ?? r.method : ""}</td>
                    <td className="py-2 pr-4 text-right">{r.direction === "in" ? pounds(r.amount_pence) : ""}</td>
                    <td className="py-2 text-right">{r.direction === "out" ? pounds(r.amount_pence) : ""}</td>
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
