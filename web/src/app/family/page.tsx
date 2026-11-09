import Link from "next/link";
import { Card, Field, Notice, SaveButton } from "@/components/fields";
import { requireMe } from "@/lib/me";
import { addFamilyMember, saveAddress } from "./actions";

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

const SAVED: Record<string, string> = {
  address: "Your address has been saved.",
  add: "Family member added.",
  member: "Family member updated.",
};
const ERRORS: Record<string, string> = {
  address: "We couldn't save the address. Please try again.",
  add: "We couldn't add that person. Please give a first and last name.",
};

function ageOn(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age -= 1;
  return age;
}

export default async function FamilyPage({ searchParams }: PageProps<"/family">) {
  const params = await searchParams;
  const { supabase, personId } = await requireMe();

  const { data: meRow } = await supabase.from("people").select("household_id").eq("id", personId).single<{ household_id: string | null }>();
  if (!meRow?.household_id) {
    return (
      <Card title="Your family">
        <p className="text-slate-700">
          You&apos;re not part of a family group yet. Please contact the membership secretary to set one up.
        </p>
      </Card>
    );
  }

  const [{ data: household }, { data: members }] = await Promise.all([
    supabase.from("households").select("*").eq("id", meRow.household_id).single<Household>(),
    supabase.from("people").select("id, first_name, last_name, date_of_birth").eq("household_id", meRow.household_id).is("archived_at", null).order("date_of_birth"),
  ]);
  const isLead = household?.lead_person_id === personId;
  const saved = typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Your family</h1>
      <Notice message={saved} />
      {error && (
        <p className="rounded bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}
      {!isLead && (
        <p className="text-slate-600">Only the main contact for your family can make changes here.</p>
      )}

      <Card title="Family members">
        <ul className="divide-y divide-slate-100">
          {(members as Member[] | null)?.map((m) => {
            const age = ageOn(m.date_of_birth);
            return (
              <li key={m.id} className="flex items-center justify-between py-2">
                <span>
                  {m.first_name} {m.last_name}
                  {m.id === household?.lead_person_id && <span className="ml-2 text-sm text-slate-500">main contact</span>}
                  {age !== null && age < 18 && <span className="ml-2 text-sm text-slate-500">junior, {age}</span>}
                </span>
                {isLead && m.id !== personId && (
                  <Link href={`/family/${m.id}`} className="text-sm text-sky-800 underline">
                    Edit
                  </Link>
                )}
                {m.id === personId && (
                  <Link href="/profile" className="text-sm text-sky-800 underline">
                    Your details
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
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
  );
}
