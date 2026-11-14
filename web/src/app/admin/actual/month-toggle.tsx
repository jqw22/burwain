"use client";

import { setMonthComplete } from "./actions";

// The "Complete" tick box in a month header. Ticking it saves straight away.
export function MonthToggle({ year, month, label, complete }: { year: number; month: number; label: string; complete: boolean }) {
  return (
    <form action={setMonthComplete} className="mt-1 flex justify-end print:hidden">
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="complete" value={complete ? "0" : "1"} />
      <input
        type="checkbox"
        defaultChecked={complete}
        aria-label={`${label} complete`}
        title={complete ? "Untick to show the budget again" : "Tick when this month's transactions are all entered"}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
    </form>
  );
}
