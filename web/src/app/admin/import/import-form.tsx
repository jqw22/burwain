"use client";

import { useActionState } from "react";
import { families, type ImportRow } from "@/lib/import";
import { importAction, type ImportState } from "./actions";

type Year = { id: string; label: string };

const button = "rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-900 disabled:opacity-50";

export function ImportForm({ years, currentYearId }: { years: Year[]; currentYearId: string | null }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importAction, { step: "upload" });

  if (state.step === "done") {
    const s = state.summary;
    return (
      <div className="space-y-4">
        <p className="rounded bg-emerald-50 p-3 text-emerald-900" role="status">
          Import finished: {s.people} people in {s.households} families added, with {s.memberships} memberships.
          {s.skipped > 0 && ` ${s.skipped} people were already in the database and were left as they were.`}
        </p>
        <p className="text-slate-700">
          Members can now sign in with the email address from the spreadsheet. Next, check family groupings and fill in
          first joined dates and news consent.
        </p>
      </div>
    );
  }

  if (state.step === "preview") {
    const groups = families(state.rows);
    return (
      <div className="space-y-6">
        <p className="text-slate-700">
          <strong>{state.fileName}</strong>: {state.rows.length} people in {groups.length} families. Nothing has been
          saved yet. People at the same address and postcode are put in one family.
        </p>
        {state.problems.length > 0 && (
          <div className="rounded bg-red-50 p-3 text-red-800" role="alert">
            <p className="font-medium">Please fix these in the spreadsheet and upload it again:</p>
            <ul className="mt-2 list-disc pl-5">
              {state.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        <ol className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {groups.map((g) => (
            <li key={g[0].household_key} className="p-3">
              <p className="text-sm text-slate-500">
                {[g[0].address_line1, g[0].postcode].filter(Boolean).join(", ") || "No address"}
              </p>
              <ul>
                {g.map((r: ImportRow, i) => (
                  <li key={i}>
                    {r.first_name} {r.last_name}
                    <span className="ml-2 text-sm text-slate-600">
                      {r.member_class}
                      {r.date_of_birth ? `, born ${r.date_of_birth.split("-").reverse().join("/")}` : ""}
                      {r.email ? `, ${r.email}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <form action={action} className="space-y-4">
          <input type="hidden" name="rows" value={JSON.stringify(state.rows)} />
          <label className="block">
            <span className="text-sm font-medium">Use the membership types starting in</span>
            <select name="club_year_id" defaultValue={currentYearId ?? years[0]?.id} className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2">
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="mark_paid" defaultChecked className="mt-1" />
            <span className="text-sm">These members have already paid for that year (untick to show them as awaiting payment)</span>
          </label>
          <div className="flex gap-4">
            <button type="submit" name="intent" value="import" disabled={pending || state.problems.length > 0} className={button}>
              {pending ? "Importing..." : `Import ${state.rows.length} people`}
            </button>
            <button type="submit" name="intent" value="start-again" className="text-sm text-slate-600 underline">
              Start again
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <p className="rounded bg-red-50 p-3 text-red-800" role="alert">
          {state.error}
        </p>
      )}
      <label className="block">
        <span className="text-sm font-medium">Member spreadsheet (.xlsx)</span>
        <input type="file" name="file" accept=".xlsx" required className="mt-1 block" />
        <span className="mt-1 block text-xs text-slate-500">
          First row must have the headings: Firstname, Lastname, Title, DOB, Address1 to Address4, Post Code, Email, Mobile,
          WhatsApp (Y/N), Emergency Contact Name, Emergency Contact Mobile, Member Class.
        </span>
      </label>
      <button type="submit" name="intent" value="preview" disabled={pending} className={button}>
        {pending ? "Reading..." : "Check spreadsheet"}
      </button>
    </form>
  );
}
