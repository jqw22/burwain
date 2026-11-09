import Link from "next/link";
import { notFound } from "next/navigation";
import { NotAllowed, STATUS_LABEL } from "@/components/admin";
import { Card, Checkbox, Field, Notice, SaveButton } from "@/components/fields";
import { ageOn, meWithRole, PERSON_FIELDS, pounds, ukDate, type Person } from "@/lib/me";
import { adminSaveAddress, adminSaveMember } from "./actions";

type Household = {
  id: string;
  lead_person_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_line3: string | null;
  address_line4: string | null;
  postcode: string | null;
};
type History = { person_id: string; club_year: string; membership_type: string; status: string; price_pence: number; paid_on: string | null; method: string | null };
type Qual = { id: string; name: string; awarded_on: string | null; expires_on: string | null };

const SAVED: Record<string, string> = {
  details: "Details saved.",
  address: "Address and main contact saved.",
  added: "New member added. Their membership, if you chose one, is on the Memberships and payments page.",
};

export default async function AdminMemberPage({ params, searchParams }: PageProps<"/admin/members/[id]">) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const { data: m } = await supabase.from("people").select(PERSON_FIELDS).eq("id", id).maybeSingle<Person>();
  if (!m) notFound();

  const [{ data: household }, { data: family }, { data: history }, { data: quals }, { data: roles }] = await Promise.all([
    m.household_id
      ? supabase.from("households").select("*").eq("id", m.household_id).maybeSingle<Household>()
      : Promise.resolve({ data: null }),
    m.household_id
      ? supabase.from("people").select("id, first_name, last_name, date_of_birth").eq("household_id", m.household_id).is("archived_at", null).order("date_of_birth")
      : Promise.resolve({ data: [] }),
    supabase.rpc("membership_history"),
    supabase.from("qualifications").select("id, name, awarded_on, expires_on").eq("person_id", id).order("expires_on"),
    supabase.from("user_roles").select("role").eq("person_id", id),
  ]);

  // Viewing medical details is logged, so it only happens when an admin asks for it.
  const showMedical = query.medical === "show";
  const medical = showMedical
    ? ((await supabase.rpc("get_medical_record", { p_person: id })).data as { details: string | null; updated_at: string }[] | null)?.[0]
    : undefined;

  const age = ageOn(m.date_of_birth);
  const myHistory = ((history ?? []) as History[]).filter((h) => h.person_id === id);
  const familyRows = (family ?? []) as { id: string; first_name: string; last_name: string; date_of_birth: string | null }[];
  const saved = typeof query.saved === "string" ? SAVED[query.saved] : undefined;

  return (
    <div className="space-y-6">
      <Link href="/admin/members" className="text-sm text-sky-800 underline">
        Back to members
      </Link>
      <h1 className="text-2xl font-semibold">
        {m.first_name} {m.last_name}
        {age !== null && <span className="ml-2 text-base font-normal text-slate-600">age {age}</span>}
      </h1>
      {(roles ?? []).length > 0 && (
        <p className="text-sm text-slate-600">Roles: {(roles as { role: string }[]).map((r) => r.role).join(", ")}</p>
      )}
      <Notice message={saved} />
      {query.error && (
        <p className="rounded bg-red-50 p-3 text-red-800" role="alert">
          We couldn&apos;t save those changes. Please check the details and try again.
        </p>
      )}

      <Card title="Details">
        <form action={adminSaveMember} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={m.id} />
          <Field label="Title" name="title" defaultValue={m.title} />
          <div />
          <Field label="First name" name="first_name" defaultValue={m.first_name} required />
          <Field label="Last name" name="last_name" defaultValue={m.last_name} required />
          <Field label="Date of birth" name="date_of_birth" type="date" defaultValue={m.date_of_birth} />
          <Field label="First joined" name="first_joined_on" type="date" defaultValue={m.first_joined_on} hint="Only admins can change this." />
          <Field label="Email" name="email" type="email" defaultValue={m.email} hint="Also their login." />
          <Field label="Mobile" name="mobile" type="tel" defaultValue={m.mobile} />
          <div className="sm:col-span-2">
            <Checkbox label="Happy to be contacted on WhatsApp" name="whatsapp" defaultChecked={m.whatsapp} />
          </div>
          <Field label="Emergency contact name" name="emergency_contact_name" defaultValue={m.emergency_contact_name} />
          <Field label="Emergency contact mobile" name="emergency_contact_mobile" type="tel" defaultValue={m.emergency_contact_mobile} />
          <p className="text-sm text-slate-600 sm:col-span-2">
            Club news by email: {m.news_consent ? "yes" : "no"}. Member directory: {m.directory_opt_out ? "opted out" : "listed"}. Only the member can change these.
          </p>
          <div className="sm:col-span-2">
            <SaveButton>Save details</SaveButton>
          </div>
        </form>
      </Card>

      <Card title="Family and address">
        {!household ? (
          <p className="text-slate-600">Not in a family group.</p>
        ) : (
          <form action={adminSaveAddress} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="person_id" value={m.id} />
            <input type="hidden" name="household_id" value={household.id} />
            <ul className="space-y-1 sm:col-span-2">
              {familyRows.map((f) => (
                <li key={f.id}>
                  {f.id === m.id ? (
                    <strong>{f.first_name} {f.last_name}</strong>
                  ) : (
                    <Link href={`/admin/members/${f.id}`} className="text-sky-800 underline">
                      {f.first_name} {f.last_name}
                    </Link>
                  )}
                  {f.id === household.lead_person_id && <span className="ml-2 text-sm text-slate-500">main contact</span>}
                </li>
              ))}
            </ul>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">Main contact</span>
              <select name="lead_person_id" defaultValue={household.lead_person_id ?? ""} className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2">
                {familyRows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.first_name} {f.last_name}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Address line 1" name="address_line1" defaultValue={household.address_line1} />
            <Field label="Address line 2" name="address_line2" defaultValue={household.address_line2} />
            <Field label="Town" name="address_line3" defaultValue={household.address_line3} />
            <Field label="County" name="address_line4" defaultValue={household.address_line4} />
            <Field label="Postcode" name="postcode" defaultValue={household.postcode} />
            <div className="sm:col-span-2">
              <SaveButton>Save address</SaveButton>
            </div>
          </form>
        )}
      </Card>

      <Card title="Membership history">
        {myHistory.length === 0 ? (
          <p className="text-slate-600">No memberships yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {myHistory.map((h, i) => (
              <li key={i} className="py-2">
                <strong>{h.club_year}</strong> {h.membership_type}: {pounds(h.price_pence)},{" "}
                {STATUS_LABEL[h.status] ?? h.status}
                {h.paid_on && <span className="text-sm text-slate-600"> (paid {ukDate(h.paid_on)}{h.method ? ` by ${h.method.replace("_", " ")}` : ""})</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Qualifications">
        {(quals ?? []).length === 0 ? (
          <p className="text-slate-600">None recorded.</p>
        ) : (
          <ul className="space-y-1">
            {(quals as Qual[]).map((q) => (
              <li key={q.id}>
                {q.name}
                {q.expires_on && <span className="ml-2 text-sm text-slate-600">expires {ukDate(q.expires_on)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Medical information">
        {showMedical ? (
          medical ? (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap">{medical.details}</p>
              <p className="text-xs text-slate-500">Last updated {ukDate(medical.updated_at)}. Your view has been recorded.</p>
            </div>
          ) : (
            <p className="text-slate-600">No medical information recorded. Your view has been recorded.</p>
          )
        ) : (
          <form method="get" className="space-y-2">
            <p className="text-sm text-slate-600">Every time someone views medical information it is recorded, with who looked and when.</p>
            <input type="hidden" name="medical" value="show" />
            <SaveButton variant="secondary">Show medical information</SaveButton>
          </form>
        )}
      </Card>
    </div>
  );
}
