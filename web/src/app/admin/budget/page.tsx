import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Notice } from "@/components/fields";
import { PrintButton } from "@/components/print-button";
import { defaultBudgetYear } from "@/lib/budget";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/me";
import { BudgetGrid, type BudgetCategory } from "./budget-grid";

const ERRORS: Record<string, string> = {
  finance: "Only finance logins can change the budget.",
  amount: "Some figures weren't amounts of money. Please use whole pounds like 1200 or 1,200 (no pence or minus signs).",
  save: "We couldn't save the budget. Please try again.",
};

// Same order as the Categories screen: the fixed member-payment categories go last.
const LOCKED = new Set(["Subscriptions", "Boat storage", "Payment fees"]);

// Finance admin > Budget: a planned amount per category per month for one calendar year.
// Finance logins can type in figures; admins can look at it.
export default async function BudgetPage({ searchParams }: PageProps<"/admin/budget">) {
  const params = await searchParams;
  await requireMe();
  const supabase = await createClient();
  const [{ data: isFinance }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("has_role", { r: "finance" }),
    supabase.rpc("has_role", { r: "admin" }),
  ]);
  if (!isFinance && !isAdmin) return <NotAllowed who="finance logins and admins" />;

  const asked = Number(params.year);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : defaultBudgetYear();

  const [{ data: cats }, { data: amounts }] = await Promise.all([
    supabase.from("transaction_categories").select("id, name, direction, is_active"),
    supabase.from("budget_amounts").select("category_id, month, amount_pence").eq("year", year),
  ]);
  const figures: Record<string, number[]> = {};
  for (const a of (amounts ?? []) as { category_id: string; month: number; amount_pence: number }[]) {
    figures[a.category_id] ??= Array(12).fill(0);
    figures[a.category_id][a.month - 1] = a.amount_pence;
  }
  // Inactive categories only appear if they already have figures for this year.
  const categories: BudgetCategory[] = ((cats ?? []) as { id: string; name: string; direction: "in" | "out"; is_active: boolean }[])
    .filter((c) => c.is_active || figures[c.id])
    .sort((a, b) => Number(LOCKED.has(a.name)) - Number(LOCKED.has(b.name)) || a.name.localeCompare(b.name))
    .map((c) => ({ ...c, pence: figures[c.id] ?? Array(12).fill(0) }));

  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const yearLink = (y: number) => (
    <Link href={`/admin/budget?year=${y}`} className="text-sky-800 underline" aria-label={`Budget for ${y}`}>
      {y}
    </Link>
  );

  return (
    <div className="space-y-6">
      <AdminNav current="budget" />
      <div className="print:hidden">
        <Notice message={params.saved ? `Budget for ${year} saved.` : undefined} />
      </div>
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">Budget for {year}</h2>
        <div className="flex items-center gap-4 print:hidden">
          <p className="flex items-baseline gap-3 text-sm">
            <span>←</span> {yearLink(year - 1)} <span className="text-slate-400">|</span> {yearLink(year + 1)} <span>→</span>
          </p>
          <PrintButton />
        </div>
      </div>
      <p className="text-sm text-slate-600 print:hidden">
        {isFinance
          ? "Type the planned amount for each category and month, then press Save budget. Figures are in whole pounds. Leave a cell blank for nothing planned. The totals update as you type."
          : "The planned amount for each category and month. Only finance logins can change the figures."}{" "}
        Categories come from the Categories screen.
      </p>

      {/* Print the budget sideways on one page width. */}
      <style>{"@media print { @page { size: A4 landscape; margin: 10mm; } }"}</style>
      <BudgetGrid key={year} year={year} categories={categories} canEdit={Boolean(isFinance)} />
    </div>
  );
}
