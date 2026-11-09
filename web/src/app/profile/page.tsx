import Link from "next/link";
import { STATUS_LABEL } from "@/components/admin";
import { Card, Checkbox, Field, Notice, SaveButton } from "@/components/fields";
import { PERSON_FIELDS, ageOn, pounds, requireMe, ukDate, type Person } from "@/lib/me";
import {
  addFamilyMember,
  addQualification,
  removeQualification,
  saveAddress,
  saveDetails,
  saveMedical,
  savePreferences,
} from "./actions";

const SAVED: Record<string, string> = {
  details: "Your details have been saved.",
  preferences: "Your preferences have been saved.",
  medical: "Your medical information has been saved.",
  qualification: "Your qualifications have been updated.",
  address: "Your address has been saved.",
  add: "Family member added.",
};
const ERRORS: Record<string, string> = {
  details: "We couldn't save your details. Please check them and try again.",
  preferences: "We couldn't save your preferences. Please try again.",
  medical: "We couldn't save your medical information. Please try again.",
  consent: "Please tick the consent box so the club can hold your medical information.",
  qualification: "We couldn't update your qualifications. Please check the name and dates.",
  address: "We couldn't save the address. Please try again.",
  add: "We couldn't add that person. Please give a first and last name.",
};

type Qualification = { id: string; name: string; awarded_on: string | null; expires_on: string | null };
type Household = {
  id: string;
  lead_person_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_line3: string | null;
  address_line4: string | null;
  postcode: string | null;
};
type Member = { id: string; first_name: string; last_name: string; date_of_birth: string | null };
type Held = {
  memberships: {
    status: string;
    price_pence: number;
    prorata_months: number;
    membership_types: { name: string } | null;
    club_years: { label: string; starts_on: string; ends_on: string } | null;
  };
};

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const params = await searchParams;
  const { supabase, personId } = await requireMe();

  const [{ data: me }, { data: medical }, { data: quals }] = await Promise.all([
    supabase.from("people").select(PERSON_FIELDS).eq("id", personId).single<Person>(),
    supabase.from("medical_records").select("details").eq("person_id", personId).maybeSingle<{ details: string | null }>(),
    supabase.from("qualifications").select("id, name, awarded_on, expires_on").eq("person_id", personId).order("expires_on"),
  ]);
  if (!me) return null;

  const [{ data: household }, { data: familyData }, { data: heldData }] = await Promise.all([
    me.household_id
      ? supabase.from("households").select("*").eq("id", me.household_id).single<Household>()
      : Promise.resolve({ data: null }),
    me.household_id
      ? supabase
          .from("people")
          .select("id, first_name, last_name, date_of_birth")
          .eq("household_id", me.household_id)
          .is("archived_at", null)
          .order("date_of_birth")
      : Promise.resolve({ data: [] }),
    supabase
      .from("membership_people")
      .select("memberships!inner(status, price_pence, prorata_months, membership_types(name), club_years(label, starts_on, ends_on))")
      .eq("person_id", personId)
      .neq("memberships.status", "cancelled"),
  ]);
  const family = ((familyData ?? []) as Member[]).filter((m) => m.id !== personId);
  const isLead = household?.lead_person_id === personId;
  // Memberships for years that haven't ended, earliest first (this year, then next year's renewal).
  const held = ((heldData ?? []) as unknown as Held[])
    .map((h) => h.memberships)
    .filter((m) => m.club_years && m.club_years.ends_on >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => (a.club_years!.starts_on < b.club_years!.starts_on ? -1 : 1));

  const saved = typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Your details</h1>
      <Notice message={saved} />
      {error && (
        <p className="rounded bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}

      <Card title="Your membership">
        {held.length === 0 ? (
          <p className="text-slate-700">You don&apos;t have a membership for this year yet.</p>
        ) : (
          <ul className="space-y-1">
            {held.map((m, i) => (
              <li key={i}>
                <strong>{m.membership_types?.name}</strong> ({m.club_years?.label}): {pounds(m.price_pence)}
                {m.prorata_months < 12 && <span className="text-sm text-slate-500"> ({m.prorata_months} months)</span>}
                <span
                  className={
                    m.status === "active"
                      ? "ml-2 rounded bg-emerald-50 px-2 py-0.5 text-sm text-emerald-900"
                      : "ml-2 rounded bg-amber-50 px-2 py-0.5 text-sm text-amber-900"
                  }
                >
                  {STATUS_LABEL[m.status] ?? m.status}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/membership" className="mt-3 inline-block text-sm text-sky-800 underline">
          Renew or add a membership
        </Link>
      </Card>

      <Card title="Contact details">
        <form action={saveDetails} className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" name="title" defaultValue={me.title} autoComplete="honorific-prefix" />
          <div className="hidden sm:block" />
          <Field label="First name" name="first_name" defaultValue={me.first_name} required autoComplete="given-name" />
          <Field label="Last name" name="last_name" defaultValue={me.last_name} required autoComplete="family-name" />
          <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={me.date_of_birth} autoComplete="bday" />
          <Field
            label="Contact email"
            name="email"
            type="email"
            defaultValue={me.email}
            autoComplete="email"
            hint="Club emails go here. To change your login email, contact the membership secretary."
          />
          <Field label="Mobile" name="mobile" type="tel" defaultValue={me.mobile} autoComplete="tel" />
          <div className="self-end pb-2">
            <Checkbox label="I'm happy to be contacted on WhatsApp" name="whatsapp" defaultChecked={me.whatsapp} />
          </div>
          <Field label="Emergency contact name" name="emergency_contact_name" defaultValue={me.emergency_contact_name} />
          <Field label="Emergency contact mobile" name="emergency_contact_mobile" type="tel" defaultValue={me.emergency_contact_mobile} />
          <div className="sm:col-span-2">
            <SaveButton>Save details</SaveButton>
          </div>
        </form>
        {me.first_joined_on && (
          <p className="mt-4 text-sm text-slate-500">Member since {me.first_joined_on.slice(0, 4)}</p>
        )}
      </Card>

      <div id="family" className="space-y-6">
        <Card title="Your family">
          {!household ? (
            <p className="text-slate-700">
              You&apos;re not part of a family group yet. Please contact the membership secretary to set one up.
            </p>
          ) : (
            <>
              {family.length === 0 ? (
                <p className="text-sm text-slate-600">No one else is in your family group yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {family.map((m) => {
                    const age = ageOn(m.date_of_birth);
                    return (
                      <li key={m.id} className="flex items-center justify-between py-2">
                        <span>
                          {m.first_name} {m.last_name}
                          {m.id === household.lead_person_id && <span className="ml-2 text-sm text-slate-500">main contact</span>}
                          {age !== null && age < 18 && <span className="ml-2 text-sm text-slate-500">junior, {age}</span>}
                        </span>
                        {isLead && (
                          <Link
                            href={`/profile/member/${m.id}`}
                            className="text-sm text-sky-800 underline"
                            aria-label={`Edit ${m.first_name} ${m.last_name}`}
                          >
                            Edit
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {!isLead && (
                <p className="mt-4 text-sm text-slate-600">Only the main contact for your family can make changes here.</p>
              )}
            </>
          )}
        </Card>

        {isLead && household && (
          <>
            <Card title="Add a family member">
              <form action={addFamilyMember} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="household_id" value={household.id} />
                <Field label="First name" name="first_name" required />
                <Field label="Last name" name="last_name" required />
                <Field label="Date of birth" name="date_of_birth" type="date" hint="Needed for junior memberships." />
                <Field label="Email (adults)" name="email" type="email" hint="Lets them sign in with their own login." />
                <Field label="Mobile" name="mobile" type="tel" />
                <div className="sm:col-span-2">
                  <SaveButton>Add to family</SaveButton>
                </div>
              </form>
            </Card>

            <Card title="Home address">
              <form action={saveAddress} className="grid gap-4 sm:grid-cols-2">
                <input type="hidden" name="household_id" value={household.id} />
                <Field label="Address line 1" name="address_line1" defaultValue={household.address_line1} autoComplete="address-line1" />
                <Field label="Address line 2" name="address_line2" defaultValue={household.address_line2} autoComplete="address-line2" />
                <Field label="Town" name="address_line3" defaultValue={household.address_line3} autoComplete="address-level2" />
                <Field label="County" name="address_line4" defaultValue={household.address_line4} autoComplete="address-level1" />
                <Field label="Postcode" name="postcode" defaultValue={household.postcode} autoComplete="postal-code" />
                <div className="sm:col-span-2">
                  <SaveButton>Save address</SaveButton>
                </div>
              </form>
            </Card>
          </>
        )}
      </div>

      <Card title="Your medical information">
        <p className="mb-4 text-sm text-slate-600">
          Anything the club should know in an emergency. Only you and club admins can see this, and every time an
          admin views it is recorded. Leave it empty and save to remove it.
        </p>
        <form action={saveMedical} className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Medical details</span>
            <textarea
              name="details"
              rows={4}
              defaultValue={medical?.details ?? ""}
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <Checkbox
            label="I agree to the club holding this information to keep me safe on the water."
            name="consent"
            defaultChecked={Boolean(medical)}
          />
          <SaveButton>Save medical information</SaveButton>
        </form>
      </Card>

      <Card title="Qualifications">
        {(quals as Qualification[] | null)?.length ? (
          <ul className="mb-4 divide-y divide-slate-100">
            {(quals as Qualification[]).map((q) => (
              <li key={q.id} className="flex items-center justify-between py-2">
                <span>
                  {q.name}
                  <span className="block text-sm text-slate-500">
                    {q.awarded_on ? `Awarded ${ukDate(q.awarded_on)}` : "Award date not given"}
                    {q.expires_on && (
                      <span className={q.expires_on < today ? "text-red-700" : undefined}>
                        {" "}
                        · {q.expires_on < today ? "Expired" : "Expires"} {ukDate(q.expires_on)}
                      </span>
                    )}
                  </span>
                </span>
                <form action={removeQualification}>
                  <input type="hidden" name="id" value={q.id} />
                  <button type="submit" className="text-sm text-slate-600 underline">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-slate-600">No qualifications recorded yet.</p>
        )}
        <form action={addQualification} className="grid gap-4 sm:grid-cols-3">
          <Field label="Qualification" name="name" required hint="For example RYA Dinghy Level 2" />
          <Field label="Awarded" name="awarded_on" type="date" />
          <Field label="Expires" name="expires_on" type="date" />
          <div className="sm:col-span-3">
            <SaveButton>Add qualification</SaveButton>
          </div>
        </form>
      </Card>
      <Card title="Communication preferences">
        <form action={savePreferences} className="space-y-3">
          <Checkbox
            label="Send me club news and newsletters by email. You can unsubscribe at any time."
            name="news_consent"
            defaultChecked={me.news_consent}
          />
          <Checkbox
            label="Show my name, phone and email in the member directory"
            name="directory_listed"
            defaultChecked={!me.directory_opt_out}
          />
          <SaveButton>Save preferences</SaveButton>
        </form>
      </Card>
    </div>
  );
}
