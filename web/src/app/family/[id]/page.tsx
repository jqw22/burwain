import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Field, SaveButton } from "@/components/fields";
import { PERSON_FIELDS, requireMe, type Person } from "@/lib/me";
import { saveFamilyMember } from "../actions";

export default async function FamilyMemberPage({ params, searchParams }: PageProps<"/family/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase } = await requireMe();
  // Row-level security only returns people in your own household.
  const { data: m } = await supabase.from("people").select(PERSON_FIELDS).eq("id", id).maybeSingle<Person>();
  if (!m) notFound();

  return (
    <div className="space-y-6">
      <Link href="/family" className="text-sm text-sky-800 underline">
        Back to your family
      </Link>
      <h1 className="text-2xl font-semibold">
        {m.first_name} {m.last_name}
      </h1>
      {query.error && (
        <p className="rounded bg-red-50 p-3 text-red-800" role="alert">
          We couldn&apos;t save those changes. Only the main contact can edit family members.
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
            <SaveButton>Save</SaveButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
