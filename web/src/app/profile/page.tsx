import { Card, Checkbox, Field, Notice, SaveButton } from "@/components/fields";
import { PERSON_FIELDS, requireMe, type Person } from "@/lib/me";
import { addQualification, removeQualification, saveDetails, saveMedical, savePreferences } from "./actions";

const SAVED: Record<string, string> = {
  details: "Your details have been saved.",
  preferences: "Your preferences have been saved.",
  medical: "Your medical information has been saved.",
  qualification: "Your qualifications have been updated.",
};
const ERRORS: Record<string, string> = {
  details: "We couldn't save your details. Please check them and try again.",
  preferences: "We couldn't save your preferences. Please try again.",
  medical: "We couldn't save your medical information. Please try again.",
  consent: "Please tick the consent box so the club can hold your medical information.",
  qualification: "We couldn't update your qualifications. Please check the name and dates.",
};

type Qualification = { id: string; name: string; awarded_on: string | null; expires_on: string | null };

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const params = await searchParams;
  const { supabase, personId } = await requireMe();

  const [{ data: me }, { data: medical }, { data: quals }] = await Promise.all([
    supabase.from("people").select(PERSON_FIELDS).eq("id", personId).single<Person>(),
    supabase.from("medical_records").select("details").eq("person_id", personId).maybeSingle<{ details: string | null }>(),
    supabase.from("qualifications").select("id, name, awarded_on, expires_on").eq("person_id", personId).order("expires_on"),
  ]);
  if (!me) return null;

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

      <Card title="Preferences">
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

      <Card title="Medical information">
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
                  {q.expires_on && (
                    <span className={q.expires_on < today ? "ml-2 text-sm text-red-700" : "ml-2 text-sm text-slate-500"}>
                      {q.expires_on < today ? "expired" : "expires"} {q.expires_on}
                    </span>
                  )}
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
    </div>
  );
}
