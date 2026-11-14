"use client";

import { useState } from "react";
import { SaveButton } from "@/components/save-button";
import { MONTHS, cellText, money, parsePounds } from "@/lib/budget";
import { saveBudget } from "./actions";

export type BudgetCategory = { id: string; name: string; direction: "in" | "out"; is_active: boolean; pence: number[] };

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// The budget table: 12 month columns plus Total; Income and Expenditure rows with sub-totals,
// and a bottom row of income minus expenditure. Totals update as figures are typed.
export function BudgetGrid({ year, categories, canEdit }: { year: number; categories: BudgetCategory[]; canEdit: boolean }) {
  const [text, setText] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, c.pence.map(cellText)])),
  );
  const [changed, setChanged] = useState(false);

  // Unreadable figures count as 0 in the totals and are outlined in red.
  const pence = (id: string, m: number) => parsePounds(text[id][m]) ?? 0;
  const rowTotals = (id: string) => MONTHS.map((_, m) => pence(id, m));
  const group = (dir: "in" | "out") => categories.filter((c) => c.direction === dir);
  const subTotals = (dir: "in" | "out") => MONTHS.map((_, m) => sum(group(dir).map((c) => pence(c.id, m))));
  const income = subTotals("in");
  const spend = subTotals("out");
  const net = MONTHS.map((_, m) => income[m] - spend[m]);
  const bad = categories.some((c) => text[c.id].some((t) => parsePounds(t) === null));

  const yy = String(year).slice(2);
  const num = "whitespace-nowrap px-1 py-1 text-right tabular-nums";
  const nameCell = "sticky left-0 z-10 whitespace-nowrap bg-inherit py-1 pl-2 pr-3 text-left";

  const totalsRow = (label: string, values: number[], strong = false) => (
    <tr className={strong ? "border-t-2 border-slate-400 bg-slate-100 font-semibold" : "border-t border-slate-300 bg-slate-50 font-medium"}>
      <th scope="row" className={nameCell}>
        {label}
      </th>
      {values.map((v, m) => (
        <td key={m} className={`${num} ${v < 0 ? "text-red-700" : ""}`}>
          {money(v)}
        </td>
      ))}
      <td className={`${num} pr-2 ${sum(values) < 0 ? "text-red-700" : ""}`}>{money(sum(values))}</td>
    </tr>
  );

  const section = (dir: "in" | "out", title: string) => (
    <>
      <tr className="bg-white">
        <th colSpan={14} scope="colgroup" className="sticky left-0 bg-white px-2 pb-1 pt-4 text-left text-base font-semibold">
          {title}
        </th>
      </tr>
      {group(dir).length === 0 && (
        <tr className="bg-white">
          <td colSpan={14} className="px-2 py-1 text-slate-600">
            No categories yet.
          </td>
        </tr>
      )}
      {group(dir).map((c) => (
        <tr key={c.id} className="border-t border-slate-100 bg-white">
          <th scope="row" className={`${nameCell} font-normal`}>
            {c.name}
            {!c.is_active && <span className="ml-1 text-xs text-slate-500">(inactive)</span>}
          </th>
          {MONTHS.map((month, m) => (
            <td key={m} className={num}>
              {canEdit ? (
                <input
                  aria-label={`${c.name} ${month} ${year}`}
                  inputMode="decimal"
                  value={text[c.id][m]}
                  onChange={(e) => {
                    const v = e.target.value;
                    setText((t) => ({ ...t, [c.id]: t[c.id].map((x, i) => (i === m ? v : x)) }));
                    setChanged(true);
                  }}
                  onBlur={() => {
                    const p = parsePounds(text[c.id][m]);
                    if (p !== null) setText((t) => ({ ...t, [c.id]: t[c.id].map((x, i) => (i === m ? cellText(p) : x)) }));
                  }}
                  className={`w-[4.75rem] rounded border px-1 py-0.5 text-right tabular-nums ${
                    parsePounds(text[c.id][m]) === null ? "border-red-500 bg-red-50" : "border-slate-300"
                  }`}
                />
              ) : (
                cellText(c.pence[m])
              )}
            </td>
          ))}
          <td className={`${num} pr-2 font-medium`}>{money(sum(rowTotals(c.id)))}</td>
        </tr>
      ))}
      {totalsRow(dir === "in" ? "Income sub-total" : "Expenditure sub-total", dir === "in" ? income : spend)}
    </>
  );

  const table = (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-xs">
        <caption className="sr-only">Budget for {year}</caption>
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-slate-50 py-2 pl-2 pr-3 text-left">
              Category
            </th>
            {MONTHS.map((m) => (
              <th key={m} scope="col" className="whitespace-nowrap px-1 py-2 text-right">
                {m} &apos;{yy}
              </th>
            ))}
            <th scope="col" className="px-1 py-2 pr-2 text-right">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {section("in", "Income")}
          {section("out", "Expenditure")}
          {totalsRow("Total (income − expenditure)", net, true)}
        </tbody>
      </table>
    </div>
  );

  if (!canEdit) return table;

  const cells = categories.flatMap((c) => MONTHS.map((_, m) => ({ category_id: c.id, month: m + 1, amount: text[c.id][m] })));
  return (
    <form action={saveBudget} className="space-y-3">
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="cells" value={JSON.stringify(cells)} />
      {table}
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton {...(bad ? { disabled: true } : {})}>Save budget</SaveButton>
        {bad ? (
          <span className="text-sm text-red-700">Some figures outlined in red aren&apos;t amounts of money.</span>
        ) : (
          changed && <span className="text-sm text-amber-800">You have changes that aren&apos;t saved yet.</span>
        )}
      </div>
    </form>
  );
}
