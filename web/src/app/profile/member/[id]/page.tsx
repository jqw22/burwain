import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Checkbox, Field, Notice, SaveButton } from "@/components/fields";
import { PERSON_FIELDS, requireMe, type Person } from "@/lib/me";
import { saveFamilyMedical, saveFamilyMember } from "../../actions";

const SAVED: Record<string, string> = {
  details: "Details saved.",
  medical: "Medical information saved.",
};
const ERRORS: Record<string, string> = {
  details: "We couldn't save those changes. Only the main contact can edit family members.",
  medical: "We couldn't save the medical information. Please try again.",
  consent: "Please tick the consent box so the club can hold this medical information.",
};

export default async function FamilyMemberPage({ params, searchParams }: PageProps<"/profile/member/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase } = await requireMe();
  // Row-level security only returns people in your own household.
  const [{ data: m }, { data: canMedical }] = await Promise.all([
    supabase.from("people").select(PERSON_FIELDS).eq("id", id).maybeSingle<Person>(),
    supabase.rpc("can_manage_family_medical", { p_person: id }),
  ]);
  if (!m) notFound();
  const { data: medical } = canMedical
    ? await supabase.from("medical_records").select("details").eq("person_id", id).maybeSingle<{ details: string | null }>()
    : { data: null };

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
        {canMedical ? (
          <>
            <p className="mb-4 text-sm text-slate-600">
              Anything the club should know about {m.first_name} in an emergency. Only your family and club admins can
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
          </>
        ) : (
          <p className="text-sm text-slate-600">
            {m.first_name} has their own login, so they add their own medical information when they sign in. (For juniors, the family&apos;s main contact can add it.)
          </p>
        )}
      </Card>
    </div>
  );
}
