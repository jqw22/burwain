"use client";

import { useActionState, useState } from "react";
import { Card, Checkbox, Field, SaveButton } from "@/components/fields";
import { adminAddMember, type AddState } from "./actions";

export type Year = { id: string; label: string; is_renewal: boolean };
export type Type = { id: string; name: string; cover: string; annual_price_pence: number; sibling_order: number | null };
export type Family = { id: string; label: string };

const select = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";
const addButton =
  "rounded border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900";
const MAX_FAMILY = 4;

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
  const [extra, setExtra] = useState(Math.max(Number(v.people_count ?? 1) - 1, 0));
  const renewalYear = years.find((y) => y.id === yearId)?.is_renewal ?? false;
  const priceFor = (t: Type) => Math.round((t.annual_price_pence * (renewalYear ? 12 : months)) / 12);
  const cover = types.find((t) => t.id === typeId)?.cover;

  // Only Dual and Family memberships take more than one person: Dual is 2, Family up to 4.
  const people =
    cover === "dual" ? (family === "existing" ? 1 : 2) : cover === "family" ? Math.min(1 + extra, MAX_FAMILY) : 1;

  return (
    <form action={action} className="space-y-6" aria-label="Add new member">
      {state.error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {state.error}
        </p>
      )}
      <input type="hidden" name="people_count" value={people} />

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
              Dual covers 2 adults and Family up to {MAX_FAMILY} people. Every other type covers one person.
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

      <Card title="Family and address">
        <fieldset className="space-y-2">
          <legend className="sr-only">Family</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="family" value="new" checked={family === "new"} onChange={() => setFamily("new")} />
            A new family (the first person below is its main contact)
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
              {cover === "dual"
                ? "Dual covers this person and the family's main contact."
                : "If the family has a Family membership, they're covered by it unless you choose a membership above."}
            </span>
          </label>
        )}
      </Card>

      {Array.from({ length: people }, (_, i) => (
        <PersonFields
          key={i}
          index={i}
          title={
            people === 1
              ? "Their details"
              : i === 0 && family === "new"
                ? "Person 1 (main contact)"
                : `Person ${i + 1}`
          }
          values={v}
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

      <div>
        <SaveButton pendingText="Adding…">{people > 1 ? `Add ${people} members` : "Add member"}</SaveButton>
      </div>
    </form>
  );
}

// Everything Your details collects for one person: details, medical information, qualifications, preferences.
function PersonFields({ index, title, values }: { index: number; title: string; values: Record<string, string> }) {
  const k = (f: string) => `p${index}_${f}`;
  const v = (f: string) => values[k(f)];
  const [quals, setQuals] = useState(1);

  return (
    <Card title={title}>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" name={k("title")} defaultValue={v("title")} />
          <div className="hidden sm:block" />
          <Field label="First name" name={k("first_name")} required defaultValue={v("first_name")} />
          <Field label="Last name" name={k("last_name")} required defaultValue={v("last_name")} />
          <Field label="Date of birth" name={k("date_of_birth")} type="date" defaultValue={v("date_of_birth")} hint="Needed for junior and U21 memberships." />
          <Field label="Email" name={k("email")} type="email" defaultValue={v("email")} hint="Adults: they log in with this email." />
          <Field label="Mobile" name={k("mobile")} type="tel" defaultValue={v("mobile")} />
          <div className="self-end pb-2">
            <Checkbox label="Happy to be contacted on WhatsApp" name={k("whatsapp")} defaultChecked={v("whatsapp") === "on"} />
          </div>
          <Field label="Emergency contact name" name={k("emergency_contact_name")} defaultValue={v("emergency_contact_name")} />
          <Field label="Emergency contact mobile" name={k("emergency_contact_mobile")} type="tel" defaultValue={v("emergency_contact_mobile")} />
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <h3 className="font-medium">Medical information</h3>
          <label className="block">
            <span className="text-sm font-medium">Medical details</span>
            <textarea
              name={k("medical_details")}
              defaultValue={v("medical_details") ?? ""}
              rows={3}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Anything the club should know in an emergency. Only the member, their family&apos;s main contact and club admins can see it.
            </span>
          </label>
          <Checkbox
            label="The member (or their parent) agrees to the club holding this information"
            name={k("medical_consent")}
            defaultChecked={v("medical_consent") === "on"}
          />
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <h3 className="font-medium">Qualifications</h3>
          {Array.from({ length: quals }, (_, j) => (
            <div key={j} className="grid gap-4 sm:grid-cols-3">
              <Field label="Qualification" name={k("qual_name")} />
              <Field label="Awarded" name={k("qual_awarded")} type="date" />
              <Field label="Expires" name={k("qual_expires")} type="date" />
            </div>
          ))}
          {quals < 5 && (
            <button type="button" className={addButton} onClick={() => setQuals(quals + 1)}>
              Add another qualification
            </button>
          )}
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-4">
          <h3 className="font-medium">Communication preferences</h3>
          <Checkbox label="Happy to receive club news by email" name={k("news_consent")} defaultChecked={v("news_consent") === "on"} />
          <Checkbox
            label="Leave out of the member directory"
            name={k("directory_opt_out")}
            defaultChecked={v("directory_opt_out") === "on"}
          />
        </div>
      </div>
    </Card>
  );
}
