"use client";

import { useActionState, useState } from "react";
import { Card, SaveButton } from "@/components/fields";
import { PersonFields, addButton } from "@/components/person-fields";
import { typeDates } from "@/lib/quote";
import { submitApplication, type JoinState } from "./actions";

export type JoinOption = {
  type_id: string;
  type_name: string;
  description: string | null;
  cover: "individual" | "dual" | "family" | "junior";
  category: "sailing" | "non_sailing";
  starts_on: string;
  ends_on: string;
  price_pence: number;
  months: number;
};

const select = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";
const MAX_FAMILY = 4;

// How many months a type runs for, counting the first and last months.
function monthsIn(o: { starts_on: string; ends_on: string }) {
  const [sy, sm] = o.starts_on.split("-").map(Number);
  const [ey, em] = o.ends_on.split("-").map(Number);
  return (ey - sy) * 12 + em - sm + 1;
}

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}

export function JoinForm({ options }: { options: JoinOption[] }) {
  const [state, action] = useActionState<JoinState, FormData>(submitApplication, {});
  const v = state.values ?? {};
  const [typeId, setTypeId] = useState(v.type_id ?? "");
  const [extra, setExtra] = useState(Math.max(Number(v.people_count ?? 1) - 1, 0));
  const chosen = options.find((o) => o.type_id === typeId);
  // Show each type's dates in the list when they don't all run for the same dates.
  const mixed = new Set(options.map((o) => `${o.starts_on}|${o.ends_on}`)).size > 1;
  const people = chosen?.cover === "dual" ? 2 : chosen?.cover === "family" ? Math.min(1 + extra, MAX_FAMILY) : 1;

  if (state.done) {
    return (
      <Card title="Thank you">
        <div className="space-y-3 text-slate-800" role="status">
          <p>
            Thanks{state.done.name ? `, ${state.done.name}` : ""}. We&apos;ve received your application for{" "}
            <strong>{state.done.type}</strong> ({state.done.year}), {state.done.price}.
          </p>
          <p>
            The membership secretary will check it and email {state.done.email || "you"} about paying. Once
            you&apos;re accepted you can log in with that email.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-6" aria-label="Join Burwain">
      {state.error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {state.error}
        </p>
      )}
      <input type="hidden" name="people_count" value={people} />
      <input type="hidden" name="type_label" value={chosen?.type_name ?? ""} />
      <input type="hidden" name="year_label" value={chosen ? typeDates(chosen) : ""} />
      <input type="hidden" name="price_label" value={chosen ? pounds(chosen.price_pence) : ""} />
      {/* Hidden from people; bots fill it in. */}
      <div aria-hidden="true" className="absolute left-[-9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <Card title="Membership">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Membership type</span>
            <select name="type_id" required value={typeId} onChange={(e) => setTypeId(e.target.value)} className={select}>
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.type_id} value={o.type_id}>
                  {o.type_name}
                  {mixed && ` (${typeDates(o)})`}: {pounds(o.price_pence)}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              {chosen?.description ??
                "Dual covers 2 adults and Family up to 4 people, including children. Every other type covers one person."}
            </span>
          </label>
          {chosen && (
            <p className="text-sm text-slate-700 sm:pt-6">
              Membership runs from {typeDates(chosen)}.
              {chosen.price_pence > 0 && chosen.months < monthsIn(chosen) &&
                ` You're joining part-way through, so the price is for the ${chosen.months} month${chosen.months === 1 ? "" : "s"} left.`}
            </p>
          )}
        </div>
      </Card>

      {chosen &&
        Array.from({ length: people }, (_, i) => (
          <PersonFields
            key={i}
            index={i}
            title={people === 1 ? "Your details" : i === 0 ? "Person 1 (main contact)" : `Person ${i + 1}`}
            values={v}
            withAddress={i === 0}
            audience="public"
          />
        ))}

      {chosen?.cover === "family" && people < MAX_FAMILY && (
        <button type="button" className={addButton} onClick={() => setExtra(extra + 1)}>
          Add another person to this Family membership
        </button>
      )}
      {chosen?.cover === "family" && people > 1 && (
        <button type="button" className={`${addButton} ml-3`} onClick={() => setExtra(Math.max(extra - 1, 0))}>
          Remove person {people}
        </button>
      )}

      {chosen && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            The club holds your details to run your membership, in line with UK data protection law. Medical
            information is only seen by club admins and, for families, your main contact.
          </p>
          <SaveButton pendingText="Sending…">Send application</SaveButton>
        </div>
      )}
    </form>
  );
}
