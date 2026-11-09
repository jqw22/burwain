"use client";

import { useActionState, useState } from "react";
import { Card, Checkbox, Field, SaveButton } from "@/components/fields";
import { adminAddMember, type AddState } from "./actions";

export type Year = { id: string; label: string; is_renewal: boolean };
export type Type = { id: string; name: string; cover: string; annual_price_pence: number; sibling_order: number | null };
export type Family = { id: string; label: string };

const select = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}

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
  const [family, setFamily] = useState(v.family ?? (householdId ? "existing" : "new"));
  const [typeId, setTypeId] = useState(v.type_id ?? "");
  const [yearId, setYearId] = useState(v.club_year_id ?? years[0]?.id ?? "");
  const renewalYear = years.find((y) => y.id === yearId)?.is_renewal ?? false;
  const priceFor = (t: Type) => Math.round((t.annual_price_pence * (renewalYear ? 12 : months)) / 12);

  return (
    <form action={action} className="space-y-6" aria-label="Add new member">
      {state.error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {state.error}
        </p>
      )}

      <Card title="Their details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" name="title" defaultValue={v.title} />
          <div className="hidden sm:block" />
          <Field label="First name" name="first_name" required defaultValue={v.first_name} />
          <Field label="Last name" name="last_name" required defaultValue={v.last_name} />
          <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={v.date_of_birth} hint="Needed for junior and U21 memberships." />
          <Field label="Email" name="email" type="email" defaultValue={v.email} hint="They log in with this email." />
          <Field label="Mobile" name="mobile" type="tel" defaultValue={v.mobile} />
          <div className="self-end pb-2">
            <Checkbox label="Happy to be contacted on WhatsApp" name="whatsapp" defaultChecked={v.whatsapp === "on"} />
          </div>
          <Field label="Emergency contact name" name="emergency_contact_name" defaultValue={v.emergency_contact_name} />
          <Field label="Emergency contact mobile" name="emergency_contact_mobile" type="tel" defaultValue={v.emergency_contact_mobile} />
        </div>
      </Card>

      <Card title="Family">
        <fieldset className="space-y-2">
          <legend className="sr-only">Family</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="family" value="new" checked={family === "new"} onChange={() => setFamily("new")} />
            A new family (they&apos;ll be its main contact)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="family" value="existing" checked={family === "existing"} onChange={() => setFamily("existing")} />
            Joining a family already in the club
          </label>
        </fieldset>
        {family === "new" ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Address line 1" name="address_line1" required defaultValue={v.address_line1} />
            <Field label="Address line 2" name="address_line2" defaultValue={v.address_line2} />
            <Field label="Town" name="address_line3" defaultValue={v.address_line3} />
            <Field label="County" name="address_line4" defaultValue={v.address_line4} />
            <Field label="Postcode" name="postcode" required defaultValue={v.postcode} />
          </div>
        ) : (
          <label className="mt-4 block">
            <span className="text-sm font-medium">Which family?</span>
            <select name="household_id" required defaultValue={v.household_id ?? householdId ?? ""} className={select}>
              <option value="">Choose a family</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              If the family has a Family membership, they&apos;re covered by it unless you choose a membership below.
            </span>
          </label>
        )}
      </Card>

      <Card title="Membership">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Club year</span>
            <select name="club_year_id" value={yearId} onChange={(e) => setYearId(e.target.value)} className={select}>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Membership type</span>
            <select name="type_id" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={select}>
              <option value="">None of their own (for example covered by a Family membership)</option>
              {types
                .filter((t) => !t.sibling_order || t.sibling_order === 1)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.cover === "junior" ? "Junior" : t.name}: {pounds(priceFor(t))}
                  </option>
                ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">
              {renewalYear
                ? "Full price for next year."
                : months < 12
                  ? `Pro rata for the ${months} month${months === 1 ? "" : "s"} left this year.`
                  : "Full price for this year."}{" "}
              Second and third juniors in a family are priced automatically. Dual covers them and the family&apos;s main contact.
            </span>
          </label>
        </div>
        {canRecordPayment && typeId && (
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

      <SaveButton pendingText="Adding…">Add member</SaveButton>
    </form>
  );
}
