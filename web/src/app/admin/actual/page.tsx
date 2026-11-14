import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { PrintButton } from "@/components/print-button";
import { MONTHS, defaultBudgetYear, money } from "@/lib/budget";
import { createClient } from "@/lib/supabase/server";
import { requireMe } from "@/lib/me";
import { MonthToggle } from "./month-toggle";

const ERRORS: Record<string, string> = {
  finance: "Only finance logins can mark months complete.",
  save: "We couldn't save that. Please try again.",
};

// Same order as the Budget and Categories screens: the fixed member-payment categories go last.
const LOCKED = new Set(["Subscriptions", "Boat storage", "Payment fees"]);

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
// Whole pounds like the Budget; blank for nothing; minus sign when below zero.
const cell = (pence: number) => {
  const pounds = Math.round(pence / 100);
  return pounds === 0 ? "" : `${pounds < 0 ? "−" : ""}${Math.abs(pounds).toLocaleString("en-GB")}`;
};

type Category = { id: string; name: string; direction: "in" | "out"; is_active: boolean };

// Finance admin > Actual: the Budget sheet, but months finance has marked complete show the actual
// figures from Transactions instead of the budget. Months not yet complete show the budget, so the
// totals and cumulative balance are actual so far plus budget for the rest of the year.
export default async function ActualPage({ searchParams }: PageProps<"/admin/actual">) {
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

  const [{ data: cats }, { data: budgetData }, { data: actualData }, { data: completeData }] = await Promise.all([
    supabase.from("transaction_categories").select("id, name, direction, is_active"),
    supabase.from("budget_amounts").select("category_id, month, amount_pence").eq("year", year),
    supabase.rpc("budget_actuals", { p_year: year }),
    supabase.from("budget_months_complete").select("month").eq("year", year),
  ]);
  const grid = (rows: { category_id: string; month: number; amount_pence: number }[] | null) => {
    const out: Record<string, number[]> = {};
    for (const r of rows ?? []) {
      out[r.category_id] ??= Array(12).fill(0);
      out[r.category_id][r.month - 1] = Number(r.amount_pence);
    }
    return out;
  };
  const budget = grid(budgetData as { category_id: string; month: number; amount_pence: number }[] | null);
  const actual = grid(actualData as { category_id: string; month: number; amount_pence: number }[] | null);
  const complete = new Set(((completeData ?? []) as { month: number }[]).map((r) => r.month - 1));

  // What each cell shows: actual for complete months, budget otherwise.
  const shown = (id: string) => MONTHS.map((_, m) => (complete.has(m) ? (actual[id]?.[m] ?? 0) : (budget[id]?.[m] ?? 0)));
  // Inactive categories only appear if they have figures this year.
  const categories = ((cats ?? []) as Category[])
    .filter((c) => c.is_active || budget[c.id] || actual[c.id])
    .sort((a, b) => Number(LOCKED.has(a.name)) - Number(LOCKED.has(b.name)) || a.name.localeCompare(b.name));
  const group = (dir: "in" | "out") => categories.filter((c) => c.direction === dir);
  const subTotals = (dir: "in" | "out") => MONTHS.map((_, m) => sum(group(dir).map((c) => shown(c.id)[m])));
  const income = subTotals("in");
  const spend = subTotals("out");
  const net = MONTHS.map((_, m) => income[m] - spend[m]);
  const cumulative = net.map((_, m) => sum(net.slice(0, m + 1)));

  const yy = String(year).slice(2);
  const num = "whitespace-nowrap px-1 py-1 text-right tabular-nums";
  const done = (m: number) => (complete.has(m) ? "bg-emerald-50" : "");
  const nameCell = "sticky left-0 z-10 whitespace-nowrap bg-inherit py-1 pl-2 pr-3 text-left";

  const totalsRow = (label: string, values: number[], strong = false, last = sum(values)) => (
    <tr className={strong ? "border-t-2 border-slate-400 bg-slate-100 font-semibold" : "border-t border-slate-300 bg-slate-50 font-medium"}>
      <th scope="row" className={nameCell}>
        {label}
      </th>
      {values.map((v, m) => (
        <td key={m} className={`${num} ${v < 0 ? "text-red-700" : ""}`}>
          {money(v)}
        </td>
      ))}
      <td className={`${num} pr-2 ${last < 0 ? "text-red-700" : ""}`}>{money(last)}</td>
    </tr>
  );
  const section = (dir: "in" | "out", title: string) => (
    <>
      <tr className="bg-white">
        <th colSpan={14} scope="colgroup" className="sticky left-0 bg-white px-2 pb-1 pt-4 text-left text-base font-semibold">
          {title}
        </th>
      </tr>
      {group(dir).map((c) => {
        const values = shown(c.id);
        return (
          <tr key={c.id} className="border-t border-slate-100 bg-white">
            <th scope="row" className={`${nameCell} font-normal`}>
              {c.name}
              {!c.is_active && <span className="ml-1 text-xs text-slate-500">(inactive)</span>}
            </th>
            {values.map((v, m) => (
              <td key={m} className={`${num} ${done(m)} ${complete.has(m) ? "" : "text-slate-500"}`}>
                {cell(v)}
              </td>
            ))}
            <td className={`${num} pr-2 font-medium`}>{money(sum(values))}</td>
          </tr>
        );
      })}
      {totalsRow(dir === "in" ? "Income sub-total" : "Expenditure sub-total", dir === "in" ? income : spend)}
    </>
  );

  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const yearLink = (y: number) => (
    <Link href={`/admin/actual?year=${y}`} className="text-sky-800 underline" aria-label={`Actual for ${y}`}>
      {y}
    </Link>
  );

  return (
    <div className="space-y-6">
      <AdminNav current="actual" />
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">Actual for {year}</h2>
        <div className="flex items-center gap-4 print:hidden">
          <p className="flex items-baseline gap-3 text-sm">
            <span>←</span> {yearLink(year - 1)} <span className="text-slate-400">|</span> {yearLink(year + 1)} <span>→</span>
          </p>
          <PrintButton />
        </div>
      </div>
      <p className="text-sm text-slate-600 print:hidden">
        The Budget sheet, with actual figures from Transactions for months marked complete (shaded green). Months not yet complete
        show the budget in grey, so the totals are actual so far plus budget for the rest of the year.{" "}
        {isFinance ? "Tick Complete in a month's heading once all its transactions are entered." : "Finance logins mark months complete."}
      </p>

      <style>{"@media print { @page { size: A4 landscape; margin: 10mm; } }"}</style>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm print:overflow-visible print:shadow-none">
        <table className="min-w-full text-xs">
          <caption className="sr-only">Actual for {year}</caption>
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-slate-50 py-2 pl-2 pr-3 text-left align-top">
                Category
              </th>
              {MONTHS.map((m, i) => (
                <th key={m} scope="col" className={`whitespace-nowrap px-1 py-2 text-right align-top ${complete.has(i) ? "bg-emerald-100" : ""}`}>
                  {m} &apos;{yy}
                  <span className="block text-[10px] font-normal">{complete.has(i) ? "Actual" : "Budget"}</span>
                  {isFinance ? (
                    <MonthToggle year={year} month={i + 1} label={`${m} ${year}`} complete={complete.has(i)} />
                  ) : null}
                </th>
              ))}
              <th scope="col" className="px-1 py-2 pr-2 text-right align-top">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {section("in", "Income")}
            {section("out", "Expenditure")}
            {totalsRow("Total", net, true)}
            {totalsRow("Cumulative balance", cumulative, false, cumulative[11])}
          </tbody>
        </table>
      </div>
    </div>
  );
}
