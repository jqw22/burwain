"use client";

import { useActionState, useState } from "react";
import { Card, Field, SaveButton } from "@/components/fields";
import { PersonFields, addButton } from "@/components/person-fields";
import { adminAddMember, type AddState } from "./actions";

export type Year = { id: string; label: string; is_renewal: boolean };
export type Type = { id: string; name: string; cover: string; annual_price_pence: number; sibling_order: number | null };
export type Family = { id: string; label: string; shared: boolean };

const select = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";
const MAX_FAMILY = 4;

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}

const JOIN = "join";


export function AddMemberForm({
  years,
  types,
  families,
  months,
  canRecordPayment,
  householdId,
  today,
}: {
  years: Year[];
  types: Type[];
  families: Family[];
  months: number;
  canRecordPayment: boolean;
  householdId?: string;
  today: string;
}) {
  const [state, action] = useActionState<AddState, FormData>(adminAddMember, {});
  const v = state.values ?? {};
  // Starts blank. "Join an existing family" adds someone to a family already in the club.
  const [choice, setChoice] = useState(v.type_choice ?? (householdId ? JOIN : ""));
  const [yearId, setYearId] = useState(v.club_year_id ?? years[0]?.id ?? "");
  const [extra, setExtra] = useState(Math.max(Number(v.people_count ?? 1) - 1, 0));
  const renewalYear = years.find((y) => y.id === yearId)?.is_renewal ?? false;
  const priceFor = (t: Type) => Math.round((t.annual_price_pence * (renewalYear ? 12 : months)) / 12);
  const joining = choice === JOIN;
  const type = types.find((t) => t.id === choice);
  const cover = type?.cover;
  // A junior joins a family already in the club, because a parent must be a member too.
  const existingFamily = joining || cover === "junior";

  // Only Dual and Family memberships take more than one person: Dual is 2, Family up to 4.
  const people = cover === "dual" ? 2 : cover === "family" ? Math.min(1 + extra, MAX_FAMILY) : 1;

  return (
    <form action={action} className="space-y-6" aria-label="Add new member">
      {state.error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {state.error}
        </p>
      )}
      <input type="hidden" name="people_count" value={choice ? people : 0} />
      <input type="hidden" name="family" value={existingFamily ? "existing" : "new"} />
      <input type="hidden" name="type_id" value={type?.id ?? ""} />

      <Card title="Membership">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Membership type</span>
            <select name="type_choice" required value={choice} onChange={(e) => setChoice(e.target.value)} className={select}>
              <option value="">Choose…</option>
              {types
                .filter((t) => !t.sibling_order || t.sibling_order === 1)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.cover === "junior" ? "Junior" : t.name}: {pounds(priceFor(t))}
                  </option>
                ))}
              <option value={JOIN}>Join existing family / dual membership</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              Dual covers 2 adults and Family up to {MAX_FAMILY} people. Every other type covers one person.
            </span>
          </label>
          {!joining && (
            <label className="block">
              <span className="text-sm font-medium">Club year</span>
              <select name="club_year_id" value={yearId} onChange={(e) => setYearId(e.target.value)} className={select}>
                {years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                {renewalYear
                  ? "Full price for next year."
                  : months < 12
                    ? `Pro rata for the ${months} month${months === 1 ? "" : "s"} left this year.`
                    : "Full price for this year."}
              </span>
            </label>
          )}
        </div>

        {existingFamily && (
          <label className="mt-4 block">
            <span className="text-sm font-medium">Which family?</span>
            <select name="household_id" required defaultValue={v.household_id ?? householdId ?? ""} className={select}>
              <option value="">Choose a family</option>
              {families.filter((f) => !joining || f.shared).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              {joining
                ? "They're covered by the family's Family or Dual membership, and share its address."
                : "A junior joins their parent's family and shares its address."}
            </span>
          </label>
        )}

        {canRecordPayment && type && (
          <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium">Payment received</span>
              <select name="payment_method" defaultValue={v.payment_method ?? ""} className={select}>
                <option value="">Not paid yet</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>
            <Field label="Date received" name="paid_on" type="date" defaultValue={v.paid_on ?? today} />
          </div>
        )}
      </Card>

      {choice &&
        Array.from({ length: people }, (_, i) => (
          <PersonFields
            key={i}
            index={i}
            title={people === 1 ? "Their details" : i === 0 ? "Person 1 (main contact)" : `Person ${i + 1}`}
            values={v}
            withAddress={i === 0 && !existingFamily}
          />
        ))}

      {cover === "family" && people < MAX_FAMILY && (
        <button type="button" className={addButton} onClick={() => setExtra(extra + 1)}>
          Add another person to this Family membership
        </button>
      )}
      {cover === "family" && people > 1 && (
        <button type="button" className={`${addButton} ml-3`} onClick={() => setExtra(Math.max(extra - 1, 0))}>
          Remove person {people}
        </button>
      )}

      {choice && (
        <div>
          <SaveButton pendingText="Adding…">{people > 1 ? `Add ${people} members` : "Add member"}</SaveButton>
        </div>
      )}
    </form>
  );
}
