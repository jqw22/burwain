"use client";

import { setReconciled } from "./actions";

// The Reconciled tick box on an Income line. Ticking it saves straight away.
export function ReconcileToggle({ line, label, reconciled, back }: { line: string; label: string; reconciled: boolean; back: string }) {
  return (
    <form action={setReconciled} className="flex justify-center">
      <input type="hidden" name="line" value={line} />
      <input type="hidden" name="reconciled" value={reconciled ? "0" : "1"} />
      <input type="hidden" name="back" value={back} />
      <input
        type="checkbox"
        defaultChecked={reconciled}
        aria-label={`Reconciled: ${label}`}
        title={reconciled ? "Untick if this payment isn't in the bank transactions yet" : "Tick once this payment is in the bank and entered as a transaction"}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
    </form>
  );
}
