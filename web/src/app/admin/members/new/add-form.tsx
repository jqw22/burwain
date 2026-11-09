"use client";

import { useActionState, useState } from "react";
import { Card, Checkbox, Field, SaveButton } from "@/components/fields";
import { adminAddMember, type AddState } from "./actions";

export type Year = { id: string; label: string; is_renewal: boolean };
export type Type = { id: string; name: string; cover: string; annual_price_pence: number; sibling_order: number | null };
export type Family = { id: string; label: string; shared: boolean };

const select = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";
const addButton =
  "rounded border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900";
const MAX_FAMILY = 4;

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}

const JOIN = "join";

// True once the form has been submitted (and came back with an error).
const submitted = (values: Record<string, string>) => "people_count" in values;

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

// Everything Your details collects for one person: details, medical information, qualifications, preferences.
function PersonFields({
  index,
  title,
  values,
  withAddress,
}: {
  index: number;
  title: string;
  values: Record<string, string>;
  withAddress: boolean;
}) {
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
          {withAddress && (
            <>
              <Field label="Address line 1" name="address_line1" required defaultValue={values.address_line1} />
              <Field label="Address line 2" name="address_line2" defaultValue={values.address_line2} />
              <Field label="Town" name="address_line3" defaultValue={values.address_line3} />
              <Field label="County" name="address_line4" defaultValue={values.address_line4} />
              <Field label="Postcode" name="postcode" required defaultValue={values.postcode} />
              <div className="hidden sm:block" />
            </>
          )}
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
            label="The member agrees to the club holding this information"
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
          {/* Both ticked to start with; after a failed save, keep what was chosen. */}
          <Checkbox
            label="Happy to receive club news by email"
            name={k("news_consent")}
            defaultChecked={submitted(values) ? v("news_consent") === "on" : true}
          />
          <Checkbox
            label="Happy to be added to the club directory"
            name={k("directory_listed")}
            defaultChecked={submitted(values) ? v("directory_listed") === "on" : true}
          />
        </div>
      </div>
    </Card>
  );
}
