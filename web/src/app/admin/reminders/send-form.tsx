"use client";

import Link from "next/link";
import { useState } from "react";
import { SaveButton } from "@/components/save-button";
import { sendReminders } from "./actions";
import type { Recipient } from "./render";

export type Row = Recipient & { price: string; reminded: string | null };

// Tick who to remind, then confirm on the page before anything is sent.
export function SendForm({ recipients, enabled, preview }: { recipients: Row[]; enabled: boolean; preview: string }) {
  const [chosen, setChosen] = useState(() => new Set(recipients.filter((r) => !r.last_reminded_at).map((r) => r.person_id)));
  const [confirming, setConfirming] = useState(false);
  const toggle = (id: string, on: boolean) =>
    setChosen((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const n = chosen.size;
  const members = `${n} ${n === 1 ? "member" : "members"}`;

  return (
    <form action={sendReminders} aria-label="Send renewal reminders" className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" className="text-sky-800 underline" onClick={() => setChosen(new Set(recipients.map((r) => r.person_id)))}>
          Tick everyone
        </button>
        <button type="button" className="text-sky-800 underline" onClick={() => setChosen(new Set())}>
          Untick everyone
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-600">
            <tr>
              <th className="py-2 pr-2"><span className="sr-only">Send</span></th>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Renewing</th>
              <th className="py-2 pr-4">Price</th>
              <th className="py-2 pr-4">Last reminded</th>
              <th className="py-2"><span className="sr-only">Preview</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recipients.map((r) => {
              const name = `${r.first_name} ${r.last_name}`;
              return (
                <tr key={r.person_id} aria-label={name} className={r.person_id === preview ? "bg-sky-50" : undefined}>
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      name="person"
                      value={r.person_id}
                      checked={chosen.has(r.person_id)}
                      onChange={(e) => toggle(r.person_id, e.target.checked)}
                      aria-label={`Send to ${name}`}
                    />
                  </td>
                  <td className="py-2 pr-4 font-medium">{name}</td>
                  <td className="py-2 pr-4">{r.email}</td>
                  <td className="py-2 pr-4">{r.membership_types}</td>
                  <td className="py-2 pr-4">{r.price}</td>
                  <td className="py-2 pr-4 text-slate-600">{r.reminded ?? "Not yet"}</td>
                  <td className="py-2 text-right">
                    <Link href={`/admin/reminders?preview=${r.person_id}#preview`} className="text-sky-800 underline" aria-label={`Preview email for ${name}`}>
                      Preview
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!enabled ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Sending isn&apos;t switched on yet. It starts working once the club&apos;s email service (Resend) is set up.
        </p>
      ) : !confirming ? (
        <button
          type="button"
          disabled={n === 0}
          onClick={() => setConfirming(true)}
          className="rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-950 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          Send to {members}
        </button>
      ) : (
        <div className="space-y-3 rounded border border-amber-300 bg-amber-50 p-4" role="alertdialog" aria-label="Confirm sending">
          <p className="font-medium text-amber-950">
            You&apos;re about to email {members}. Emails can&apos;t be unsent once they&apos;ve gone.
          </p>
          <div className="flex items-center gap-4">
            <SaveButton pendingText="Sending…">Yes, send now</SaveButton>
            <button type="button" className="text-sm text-slate-700 underline" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
