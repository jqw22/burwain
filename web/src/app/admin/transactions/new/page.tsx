import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, SaveButton } from "@/components/fields";
import { meWithRole } from "@/lib/me";
import { addTransaction } from "../actions";
import { DirectionAndCategory } from "./direction-category";

type Category = { id: string; name: string; direction: "in" | "out" };

const ERRORS: Record<string, string> = {
  finance: "Only finance logins can add transactions.",
  direction: "Please choose Money in or Money out.",
  date: "Please give the date of the transaction.",
  description: "Please say what the transaction was for.",
  amount: "Please give an amount in pounds, more than £0, for example 125.50.",
  nocategory: "Please choose a category.",
  category: "That category is for money going the other way. Please pick another.",
  inactive: "That category is no longer in use. Please pick another.",
  save: "We couldn't save that transaction. Please check the details and try again.",
};
const METHODS = [
  ["bank_transfer", "Bank transfer"],
  ["card", "Card"],
  ["direct_debit", "Direct Debit"],
  ["cash", "Cash"],
  ["cheque", "Cheque"],
] as const;

const input = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";

export default async function NewTransactionPage({ searchParams }: PageProps<"/admin/transactions/new">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) return <NotAllowed who="finance logins" />;

  const { data } = await supabase.from("transaction_categories").select("id, name, direction").eq("is_active", true).order("name");
  const categories = (data ?? []) as Category[];
  const v = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const error = ERRORS[v("error")];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const direction = v("direction") || "out";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add transaction</h1>
      <AdminNav current="transactions" />
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}

      <Card title="Transaction details">
        <form action={addTransaction} className="space-y-4">
          <DirectionAndCategory categories={categories} direction={direction === "in" ? "in" : "out"} categoryId={v("category_id")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Date</span>
              <input type="date" name="occurred_on" required defaultValue={v("occurred_on") || today} className={input} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Amount (£)</span>
              <input name="amount" required inputMode="decimal" placeholder="0.00" defaultValue={v("amount")} className={input} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">Description</span>
            <input name="description" required placeholder="For example: Boat insurance 2027" defaultValue={v("description")} className={input} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Paid to / received from</span>
            <input name="party" placeholder="For example: the supplier's name" defaultValue={v("party")} className={input} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">How paid</span>
              <select name="method" defaultValue={v("method") || "bank_transfer"} className={input}>
                {METHODS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-4">
            <SaveButton>Add transaction</SaveButton>
            <Link href="/admin/transactions" className="text-sm text-slate-600 underline">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
