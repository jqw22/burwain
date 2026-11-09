import Link from "next/link";
import { STATUS_LABEL } from "@/components/admin";
import { Card, Checkbox, Field, Notice, SaveButton } from "@/components/fields";
import { PERSON_FIELDS, ageOn, pounds, requireMe, ukDate, type Person } from "@/lib/me";
import {
  addFamilyMember,
  addQualification,
  createHousehold,
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
  household: "Your family group is set up. You can now add family members.",
};
const ERRORS: Record<string, string> = {
  details: "We couldn't save your details. Please check them and try again.",
  preferences: "We couldn't save your preferences. Please try again.",
  medical: "We couldn't save your medical information. Please try again.",
  consent: "Please tick the consent box so the club can hold your medical information.",
  qualification: "We couldn't update your qualifications. Please check the name and dates.",
  address: "We couldn't save the address. Please try again.",
  add: "We couldn't add that person. Please give a first and last name.",
  household: "We couldn't set up your family group. Please try again.",
};

const SECTION: Record<string, string> = {
  details: "contact",
  add: "family",
  household: "family",
  address: "address",
  medical: "medical",
  consent: "medical",
  qualification: "qualifications",
  preferences: "preferences",
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
type Member = { id: string; first_name: string; last_name: string; date_of_birth: string | null; whatsapp: boolean };
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
          .select("id, first_name, last_name, date_of_birth, whatsapp")
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
  const editing = typeof params.edit === "string" ? params.edit : null;
  // Messages appear inside the box they belong to, since the page opens at that box.
  const savedKey = typeof params.saved === "string" ? params.saved : "";
  const errorKey = typeof params.error === "string" ? params.error : "";
  const messages = (section: string) => (
    <>
      {SECTION[savedKey] === section && (
        <div className="mb-4">
          <Notice message={saved} />
        </div>
      )}
      {SECTION[errorKey] === section && error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}
    </>
  );
  const qualifications = (quals ?? []) as Qualification[];
  const addressLines = household
    ? [household.address_line1, household.address_line2, household.address_line3, household.address_line4, household.postcode].filter(Boolean)
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Your details</h1>

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

      <Card
        id="contact"
        title="Contact details"
        action={editing !== "contact" && <EditLink section="contact" label="contact details" />}
      >
        {messages("contact")}
        {editing === "contact" ? (
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
            <FormButtons section="contact">Save details</FormButtons>
          </form>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item label="Name" value={[me.title, me.first_name, me.last_name].filter(Boolean).join(" ")} />
            <Item label="Date of birth" value={me.date_of_birth && ukDate(me.date_of_birth)} />
            <Item label="Contact email" value={me.email} />
            <Item label="Mobile" value={me.mobile} />
            <Item label="Happy to be contacted on WhatsApp" value={me.whatsapp ? "Yes" : "No"} />
            <Item
              label="Emergency contact"
              value={[me.emergency_contact_name, me.emergency_contact_mobile].filter(Boolean).join(", ")}
            />
            {me.first_joined_on && <Item label="Member since" value={me.first_joined_on.slice(0, 4)} />}
          </dl>
        )}
      </Card>

      <Card
        id="family"
        title="Your family"
        action={household && isLead && editing !== "family" && <EditLink section="family" label="family" text="Add a family member" />}
      >
        {messages("family")}
        {!household ? (
          <form action={createHousehold} className="grid gap-4 sm:grid-cols-2">
            <p className="text-slate-700 sm:col-span-2">
              You&apos;re not in a family group yet. Add your home address to set one up. You&apos;ll be the main
              contact and can then add your family.
            </p>
            <Field label="Address line 1" name="address_line1" required autoComplete="address-line1" />
            <Field label="Address line 2" name="address_line2" autoComplete="address-line2" />
            <Field label="Town" name="address_line3" autoComplete="address-level2" />
            <Field label="County" name="address_line4" autoComplete="address-level1" />
            <Field label="Postcode" name="postcode" required autoComplete="postal-code" />
            <div className="sm:col-span-2">
              <SaveButton>Set up my family</SaveButton>
            </div>
          </form>
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
                        <span className="block text-sm text-slate-500">WhatsApp: {m.whatsapp ? "yes" : "no"}</span>
                      </span>
                      {isLead && (
                        <Link
                          href={`/profile/member/${m.id}`}
                          className={LINK}
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
            {isLead && editing === "family" && (
              <form
                action={addFamilyMember}
                aria-label="Add a family member"
                className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2"
              >
                <h3 className="font-medium sm:col-span-2">Add a family member</h3>
                <input type="hidden" name="household_id" value={household.id} />
                <Field label="First name" name="first_name" required />
                <Field label="Last name" name="last_name" required />
                <Field label="Date of birth" name="date_of_birth" type="date" hint="Needed for junior memberships." />
                <Field label="Email (adults)" name="email" type="email" hint="Lets them sign in with their own login." />
                <Field label="Mobile" name="mobile" type="tel" />
                <div className="self-end pb-2">
                  <Checkbox label="Happy to be contacted on WhatsApp" name="whatsapp" />
                </div>
                <FormButtons section="family" cancelText="Done">Add to family</FormButtons>
              </form>
            )}
          </>
        )}
      </Card>

      {household && (
        <Card
          id="address"
          title="Home address"
          action={isLead && editing !== "address" && <EditLink section="address" label="home address" />}
        >
          {messages("address")}
          {isLead && editing === "address" ? (
            <form action={saveAddress} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="household_id" value={household.id} />
              <Field label="Address line 1" name="address_line1" defaultValue={household.address_line1} autoComplete="address-line1" />
              <Field label="Address line 2" name="address_line2" defaultValue={household.address_line2} autoComplete="address-line2" />
              <Field label="Town" name="address_line3" defaultValue={household.address_line3} autoComplete="address-level2" />
              <Field label="County" name="address_line4" defaultValue={household.address_line4} autoComplete="address-level1" />
              <Field label="Postcode" name="postcode" defaultValue={household.postcode} autoComplete="postal-code" />
              <FormButtons section="address">Save address</FormButtons>
            </form>
          ) : addressLines.length ? (
            <address className="not-italic text-slate-800">
              {addressLines.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </address>
          ) : (
            <p className="text-sm text-slate-600">No address recorded yet.</p>
          )}
        </Card>
      )}

      <Card
        id="medical"
        title="Your medical information"
        action={editing !== "medical" && <EditLink section="medical" label="medical information" />}
      >
        {messages("medical")}
        <p className="mb-4 text-sm text-slate-600">
          Anything the club should know in an emergency. Only you, your family&apos;s main contact and club admins can
          see this, and every time an admin views it is recorded.
        </p>
        {editing === "medical" ? (
          <form action={saveMedical} className="space-y-3">
            <label className="block">
              <span className="text-sm font-medium">Medical details</span>
              <textarea
                name="details"
                rows={4}
                defaultValue={medical?.details ?? ""}
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"
              />
              <span className="mt-1 block text-xs text-slate-500">Leave it empty and save to remove it.</span>
            </label>
            <Checkbox
              label="I agree to the club holding this information to keep me safe on the water."
              name="consent"
              defaultChecked={Boolean(medical)}
            />
            <FormButtons section="medical">Save medical information</FormButtons>
          </form>
        ) : (
          <p className="whitespace-pre-line text-slate-800">{medical?.details || "Nothing recorded."}</p>
        )}
      </Card>

      <Card
        id="qualifications"
        title="Qualifications"
        action={editing !== "qualifications" && <EditLink section="qualifications" label="qualifications" />}
      >
        {messages("qualifications")}
        {qualifications.length ? (
          <ul className="divide-y divide-slate-100">
            {qualifications.map((q) => (
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
                {editing === "qualifications" && (
                  <form action={removeQualification}>
                    <input type="hidden" name="id" value={q.id} />
                    <SaveButton variant="link" pendingText="Removing…" aria-label={`Remove ${q.name}`}>
                      Remove
                    </SaveButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">No qualifications recorded yet.</p>
        )}
        {editing === "qualifications" && (
          <form action={addQualification} className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
            <Field label="Qualification" name="name" required hint="For example RYA Dinghy Level 2" />
            <Field label="Awarded" name="awarded_on" type="date" />
            <Field label="Expires" name="expires_on" type="date" />
            <FormButtons section="qualifications" cancelText="Done" wide>
              Add qualification
            </FormButtons>
          </form>
        )}
      </Card>

      <Card
        id="preferences"
        title="Communication preferences"
        action={editing !== "preferences" && <EditLink section="preferences" label="communication preferences" />}
      >
        {messages("preferences")}
        {editing === "preferences" ? (
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
            <FormButtons section="preferences">Save preferences</FormButtons>
          </form>
        ) : (
          <ul className="space-y-1 text-slate-800">
            <li>Club news by email: {me.news_consent ? "yes" : "no"}</li>
            <li>Listed in the member directory: {me.directory_opt_out ? "no" : "yes"}</li>
          </ul>
        )}
      </Card>
    </div>
  );
}

const LINK =
  "rounded px-1 text-sm text-sky-800 underline underline-offset-2 hover:bg-sky-50 hover:text-sky-950 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

function EditLink({ section, label, text = "Edit" }: { section: string; label: string; text?: string }) {
  return (
    <Link
      href={`/profile?edit=${section}#${section}`}
      scroll={false}
      className={LINK}
      aria-label={text === "Edit" ? `Edit ${label}` : undefined}
    >
      {text}
    </Link>
  );
}

function FormButtons({
  section,
  children,
  cancelText = "Cancel",
  wide,
}: {
  section: string;
  children: React.ReactNode;
  cancelText?: string;
  wide?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 ${wide ? "sm:col-span-3" : "sm:col-span-2"}`}>
      <SaveButton>{children}</SaveButton>
      <Link href={`/profile#${section}`} scroll={false} className={LINK}>
        {cancelText}
      </Link>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value || "Not given"}</dd>
    </div>
  );
}
