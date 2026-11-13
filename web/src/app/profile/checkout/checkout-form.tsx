"use client";

import { useState } from "react";
import { BoatFields, pounds } from "@/components/boat-fields";
import { Card, SaveButton } from "@/components/fields";
import type { Boat } from "@/lib/boats";

type Line = { id: string; kind: "membership" | "storage"; title: string; detail: string[]; pence: number };

// The order (memberships and any boats awaiting payment), boats to add at £35 each, and the
// test Pay button. Last time's boats are filled in to start with; they can be removed.
export function CheckoutForm({
  action,
  lines,
  baseTotal,
  boatPrice,
  maxNewBoats,
  suggestedBoats,
}: {
  action: (form: FormData) => void;
  lines: Line[];
  baseTotal: number;
  boatPrice: number;
  maxNewBoats: number;
  suggestedBoats: Boat[];
}) {
  const [boats, setBoats] = useState<Boat[]>(suggestedBoats);
  const total = baseTotal + boats.length * boatPrice;
  return (
    <form action={action} aria-label="Payment" className="space-y-6">
      <Card title="Your order">
        <table className="w-full text-left text-sm">
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-4">
                  <strong>{l.title}</strong>
                  {l.detail.filter(Boolean).map((d) => (
                    <span key={d} className="block text-slate-600">
                      {d}
                    </span>
                  ))}
                  <input type="hidden" name={l.kind === "membership" ? "membership_id" : "storage_id"} value={l.id} />
                </td>
                <td className="py-2 text-right">{pounds(l.pence)}</td>
              </tr>
            ))}
            {boats.map((b, i) => (
              <tr key={`new-${i}`}>
                <td className="py-2 pr-4">
                  <strong>Boat storage</strong>
                  <span className="block text-slate-600">{`${b.boat_class} ${b.sail_number}`.trim() || `Boat ${i + 1}`}</span>
                </td>
                <td className="py-2 text-right">{pounds(boatPrice)}</td>
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
        {maxNewBoats > 0 && (
          <div className="mt-6 border-t border-slate-100 pt-4">
            <BoatFields boats={boats} onChange={setBoats} max={maxNewBoats} price={boatPrice} />
          </div>
        )}
      </Card>
      <Card title="Payment">
        <div className="space-y-4">
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Test checkout.</strong> No money is taken and no card or bank details are asked for, but the payment is
            recorded and your membership is marked as paid. Online payment by card and Direct Debit will be switched on later.
          </p>
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
          <SaveButton pendingText="Processing…">Pay {pounds(total)}</SaveButton>
        </div>
      </Card>
    </form>
  );
}
