import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Checkbox, Field, Notice, SaveButton } from "@/components/fields";
import { PERSON_FIELDS, requireMe, ukDate, type Person } from "@/lib/me";
import {
  addFamilyQualification,
  removeFamilyQualification,
  saveFamilyMedical,
  saveFamilyMember,
  saveFamilyPreferences,
} from "../../actions";

type Qualification = { id: string; name: string; awarded_on: string | null; expires_on: string | null };

const SAVED: Record<string, string> = {
  details: "Details saved.",
  medical: "Medical information saved.",
  qualification: "Qualifications updated.",
  preferences: "Preferences saved.",
};
const ERRORS: Record<string, string> = {
  details: "We couldn't save those changes. Please check them and try again.",
  medical: "We couldn't save the medical information. Please try again.",
  consent: "Please tick the consent box so the club can hold this medical information.",
  qualification: "We couldn't update the qualifications. Please check the name and dates.",
  preferences: "We couldn't save the preferences. Please try again.",
};

export default async function FamilyMemberPage({ params, searchParams }: PageProps<"/profile/member/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase } = await requireMe();
  // Row-level security only returns people in your own household.
  const [{ data: m }, { data: canManage }, { data: medical }, { data: qualsData }] = await Promise.all([
    supabase.from("people").select(PERSON_FIELDS).eq("id", id).maybeSingle<Person>(),
    supabase.rpc("can_manage_family_member", { p_person: id }),
    supabase.from("medical_records").select("details").eq("person_id", id).maybeSingle<{ details: string | null }>(),
    supabase.from("qualifications").select("id, name, awarded_on, expires_on").eq("person_id", id).order("expires_on"),
  ]);
  if (!m) notFound();
  if (!canManage) {
    return (
      <Card title="Main contact only">
        <p className="text-slate-700">Only your family&apos;s main contact can change other family members&apos; details.</p>
      </Card>
    );
  }
  const quals = (qualsData ?? []) as Qualification[];
  const today = new Date().toISOString().slice(0, 10);

  const saved = typeof query.saved === "string" ? SAVED[query.saved] : undefined;
  const error = typeof query.error === "string" ? ERRORS[query.error] : undefined;

  return (
    <div className="space-y-6">
      <Link href="/profile#family" className="text-sm text-sky-800 underline">
        Back to your details
      </Link>
      <h1 className="text-2xl font-semibold">
        {m.first_name} {m.last_name}
      </h1>
      <Notice message={saved} />
      {error && (
        <p className="rounded bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}
      <Card title="Details">
        <form action={saveFamilyMember} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={m.id} />
          <Field label="First name" name="first_name" defaultValue={m.first_name} required />
          <Field label="Last name" name="last_name" defaultValue={m.last_name} required />
          <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={m.date_of_birth} />
          <Field label="Email" name="email" type="email" defaultValue={m.email} />
          <Field label="Mobile" name="mobile" type="tel" defaultValue={m.mobile} />
          <div />
          <Field label="Emergency contact name" name="emergency_contact_name" defaultValue={m.emergency_contact_name} />
          <Field label="Emergency contact mobile" name="emergency_contact_mobile" type="tel" defaultValue={m.emergency_contact_mobile} />
          <div className="sm:col-span-2">
            <SaveButton>Save details</SaveButton>
          </div>
        </form>
      </Card>

      <Card title="Medical information">
            <p className="mb-4 text-sm text-slate-600">
              Anything the club should know about {m.first_name} in an emergency. Only your family&apos;s main contact, {m.first_name} and club admins can
              see this, and every time an admin views it is recorded. Leave it empty and save to remove it.
            </p>
            <form action={saveFamilyMedical} className="space-y-3">
              <input type="hidden" name="id" value={m.id} />
              <label className="block">
                <span className="text-sm font-medium">Medical details</span>
                <textarea
                  name="details"
                  rows={4}
                  defaultValue={medical?.details ?? ""}
                  className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"
                />
              </label>
              <Checkbox
                label={`I agree to the club holding this information to keep ${m.first_name} safe on the water.`}
                name="consent"
                defaultChecked={Boolean(medical)}
              />
              <SaveButton>Save medical information</SaveButton>
            </form>
          
      </Card>

      <Card title="Qualifications">
        {quals.length ? (
          <ul className="mb-4 divide-y divide-slate-100">
            {quals.map((q) => (
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
                <form action={removeFamilyQualification}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="person_id" value={m.id} />
                  <SaveButton variant="link" pendingText="Removing…">
                    Remove
                  </SaveButton>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-sm text-slate-600">No qualifications recorded yet.</p>
        )}
        <form action={addFamilyQualification} className="grid gap-4 sm:grid-cols-3">
          <input type="hidden" name="id" value={m.id} />
          <Field label="Qualification" name="name" required hint="For example RYA Stage 1" />
          <Field label="Awarded" name="awarded_on" type="date" />
          <Field label="Expires" name="expires_on" type="date" />
          <div className="sm:col-span-3">
            <SaveButton>Add qualification</SaveButton>
          </div>
        </form>
      </Card>

      <Card title="Communication preferences">
        <form action={saveFamilyPreferences} className="space-y-3">
          <input type="hidden" name="id" value={m.id} />
          <Checkbox
            label="Send club news and newsletters by email. They can unsubscribe at any time."
            name="news_consent"
            defaultChecked={m.news_consent}
          />
          <Checkbox
            label="Show their name, phone and email in the member directory (adults only)"
            name="directory_listed"
            defaultChecked={!m.directory_opt_out}
          />
          <SaveButton>Save preferences</SaveButton>
        </form>
      </Card>
    </div>
  );
}
