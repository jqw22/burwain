import Link from "next/link";
import { notFound } from "next/navigation";
import { NotAllowed, STATUS_LABEL } from "@/components/admin";
import { Card, Checkbox, Field, Notice, SaveButton } from "@/components/fields";
import { EditLink, FormButtons, Item, LINK } from "@/app/profile/ui";
import { ageOn, meWithRole, PERSON_FIELDS, pounds, ukDate, type Person } from "@/lib/me";
import { RenewForm, type RenewPerson, type RenewType } from "@/app/profile/renew-form";
import { quote, typeDates, ukToday } from "@/lib/quote";
import {
  adminAddBoat,
  adminAddQualification,
  adminRemoveBoat,
  adminRenewMembership,
  adminRemoveQualification,
  adminSaveAddress,
  adminSaveLead,
  adminSaveMedical,
  adminSaveMember,
  adminSavePreferences,
} from "./actions";

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
type AdminBoat = {
  id: string;
  boat_class: string | null;
  sail_number: string | null;
  price_pence: number;
  status: string;
  starts_on: string;
  ends_on: string;
  boat_storage_options: { members_rate: boolean } | null;
};
type Relative = { id: string; first_name: string; last_name: string; date_of_birth: string | null; whatsapp: boolean };

const SAVED: Record<string, string> = {
  details: "Details saved.",
  address: "Address saved.",
  lead: "Main contact saved.",
  medical: "Medical information saved.",
  qualification: "Qualifications updated.",
  preferences: "Preferences saved.",
  accepted: "Application accepted: they're now a member, with their membership awaiting payment.",
  added: "New member added. Their membership, if you chose one, is on the Payments page.",
  contact: "Contact added. They'll get club emails if they agreed to them. To make them a member, add a membership below.",
  renewed: "Membership added. It's awaiting payment; finance can record the payment on the Income page.",
  boats: "Boat storage updated.",
};
const ERRORS: Record<string, string> = {
  details: "We couldn't save those details. Please check them and try again.",
  address: "We couldn't save the address. Please try again.",
  lead: "We couldn't change the main contact. Please try again.",
  medical: "We couldn't save the medical information. Please try again.",
  qualification: "We couldn't update the qualifications. Please check the name and dates.",
  preferences: "We couldn't save the preferences. Please try again.",
  who: "Please tick who the membership is for.",
  age: "Someone is over the age limit for that membership, or their date of birth is missing.",
  duplicate: "Someone ticked already has that kind of membership for that year.",
  adult: "A junior needs an adult in the family with a membership for the same year. Renew the adult first.",
  count: "That membership type doesn't cover that number of people.",
  unavailable: "That membership type isn't available.",
  renew: "We couldn't add that membership. Please try again.",
  boats: "We couldn't add that boat. Give a class, sail number and dates; up to 3 boats per membership; a payment needs its date.",
  boatremove: "Only boat storage that hasn't been paid for can be removed.",
};
const SECTION: Record<string, string> = {
  details: "contact",
  address: "address",
  lead: "family",
  medical: "medical",
  qualification: "qualifications",
  preferences: "preferences",
  renewed: "membership",
  contact: "membership",
  who: "membership",
  age: "membership",
  duplicate: "membership",
  adult: "membership",
  count: "membership",
  unavailable: "membership",
  renew: "membership",
  boats: "boats",
  boatremove: "boats",
};

// An admin's view of one member: the same boxes as Your details, each opened for editing with its Edit link.
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
      ? supabase
          .from("people")
          .select("id, first_name, last_name, date_of_birth, whatsapp")
          .eq("household_id", m.household_id)
          .is("archived_at", null)
          .order("date_of_birth")
      : Promise.resolve({ data: [] }),
    supabase.rpc("membership_history"),
    supabase.from("qualifications").select("id, name, awarded_on, expires_on").eq("person_id", id).order("expires_on"),
    supabase.from("user_roles").select("role").eq("person_id", id),
  ]);
  const [{ data: boatData }, { data: storagePrices }] = await Promise.all([
    supabase
      .from("boat_storages")
      .select("id, boat_class, sail_number, price_pence, status, starts_on, ends_on, boat_storage_options(members_rate)")
      .or(m.household_id ? `household_id.eq.${m.household_id},person_id.eq.${m.id}` : `person_id.eq.${m.id}`)
      .neq("status", "cancelled")
      .order("starts_on", { ascending: false })
      .order("created_at"),
    supabase.from("boat_storage_options").select("members_rate, price_pence"),
  ]);
  const boats = (boatData ?? []) as unknown as AdminBoat[];
  const ratePrice = (members: boolean) =>
    ((storagePrices ?? []) as { members_rate: boolean; price_pence: number }[]).find((o) => o.members_rate === members)?.price_pence ?? 0;
  const thisYear = ukToday().slice(0, 4);

  // Only Family and Dual memberships take extra family members, so new members can only join those families.
  const { data: sharedData } = household
    ? await supabase
        .from("memberships")
        .select("id, membership_types!inner(cover, ends_on)")
        .eq("household_id", household.id)
        .neq("status", "cancelled")
        .in("membership_types.cover", ["family", "dual"])
        .gte("membership_types.ends_on", ukToday())
        .limit(1)
    : { data: [] };
  const canAddToFamily = (sharedData ?? []).length > 0;

  // Renewing or adding a membership for this member and their family: any active type that hasn't ended,
  // priced as if bought today. The database stops anyone having two of the same kind for the same dates.
  const today0 = ukToday();
  const { data: openTypes } = await supabase
    .from("membership_types")
    .select("id, name, description, cover, annual_price_pence, max_age, sibling_order, starts_on, ends_on")
    .eq("is_open", true)
    .gte("ends_on", today0)
    .order("starts_on")
    .order("sort_order");
  const familyPeople = m.household_id ? ((family ?? []) as Relative[]) : [{ id: m.id, first_name: m.first_name, last_name: m.last_name, date_of_birth: m.date_of_birth }];
  const renewPeople = familyPeople.map((p): RenewPerson => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, date_of_birth: p.date_of_birth }));
  const renewTypes = ((openTypes ?? []) as (RenewType & { sibling_order: number | null })[])
    .filter((t) => t.sibling_order === null || t.sibling_order === 1)
    .map((t) => ({ ...t, annual_price_pence: quote(t, today0).price }));

  const base = `/admin/members/${id}`;
  const editing = typeof query.edit === "string" ? query.edit : null;
  // Viewing medical details is logged, so it only happens when an admin asks to see or edit them.
  const showMedical = query.medical === "show" || editing === "medical";
  const medical = showMedical
    ? ((await supabase.rpc("get_medical_record", { p_person: id })).data as { details: string | null; updated_at: string }[] | null)?.[0]
    : undefined;

  const age = ageOn(m.date_of_birth);
  const today = new Date().toISOString().slice(0, 10);
  const myHistory = ((history ?? []) as History[]).filter((h) => h.person_id === id);
  const relatives = (family ?? []) as Relative[];
  const qualifications = (quals ?? []) as Qual[];
  const addressLines = household
    ? [household.address_line1, household.address_line2, household.address_line3, household.address_line4, household.postcode].filter(Boolean)
    : [];

  const savedKey = typeof query.saved === "string" ? query.saved : "";
  const errorKey = typeof query.error === "string" ? query.error : "";
  const messages = (section: string) => (
    <>
      {SECTION[savedKey] === section && (
        <div className="mb-4">
          <Notice message={SAVED[savedKey]} />
        </div>
      )}
      {SECTION[errorKey] === section && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {ERRORS[errorKey]}
        </p>
      )}
    </>
  );
  const edit = (section: string, label: string) => editing !== section && <EditLink base={base} section={section} label={label} />;

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
      {(savedKey === "added" || savedKey === "accepted") && <Notice message={SAVED[savedKey]} />}

      <Card id="membership" title="Membership">
        {messages("membership")}
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
        <Link href="/admin/memberships" className={`mt-3 inline-block ${LINK}`}>
          Payments
        </Link>
        {renewTypes.length > 0 && (
          <div className="mt-4 rounded border border-sky-200 bg-sky-50 p-4">
            <h3 className="font-medium text-sky-950">Renew or add a membership</h3>
            <p className="text-sm text-slate-600">
              Any active membership type that hasn&apos;t ended. Prices are what they&apos;d pay today: types that have already started are
              charged for the months left.
            </p>
            <RenewForm
              people={renewPeople}
              types={renewTypes}
              action={adminRenewMembership}
              extra={{ member_id: m.id }}
              button="Save membership"
            />
          </div>
        )}
      </Card>

      <Card id="contact" title="Contact details" action={edit("contact", "contact details")}>
        {messages("contact")}
        {editing === "contact" ? (
          <form action={adminSaveMember} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={m.id} />
            <Field label="Title" name="title" defaultValue={m.title} />
            <div className="hidden sm:block" />
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
            <FormButtons base={base} section="contact">Save details</FormButtons>
          </form>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Item label="Name" value={[m.title, m.first_name, m.last_name].filter(Boolean).join(" ")} />
            <Item label="Date of birth" value={m.date_of_birth && ukDate(m.date_of_birth)} />
            <Item label="Email (also their login)" value={m.email} />
            <Item label="Mobile" value={m.mobile} />
            <Item label="Happy to be contacted on WhatsApp" value={m.whatsapp ? "Yes" : "No"} />
            <Item label="Emergency contact" value={[m.emergency_contact_name, m.emergency_contact_mobile].filter(Boolean).join(", ")} />
            <Item label="First joined" value={m.first_joined_on && ukDate(m.first_joined_on)} />
          </dl>
        )}
      </Card>

      <Card id="family" title="Family" action={household && edit("family", "main contact")}>
        {messages("family")}
        {!household ? (
          <p className="text-slate-600">Not in a family group.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {relatives.map((f) => {
                const a = ageOn(f.date_of_birth);
                return (
                  <li key={f.id} className="flex items-center justify-between py-2">
                    <span>
                      {f.first_name} {f.last_name}
                      {f.id === household.lead_person_id && <span className="ml-2 text-sm text-slate-500">main contact</span>}
                      {a !== null && a < 18 && <span className="ml-2 text-sm text-slate-500">junior, {a}</span>}
                      <span className="block text-sm text-slate-500">WhatsApp: {f.whatsapp ? "yes" : "no"}</span>
                    </span>
                    {f.id !== m.id && (
                      <Link href={`/admin/members/${f.id}`} className={LINK} aria-label={`Open ${f.first_name} ${f.last_name}`}>
                        Open
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            {editing === "family" ? (
              <form action={adminSaveLead} className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <input type="hidden" name="person_id" value={m.id} />
                <input type="hidden" name="household_id" value={household.id} />
                <label className="block">
                  <span className="text-sm font-medium">Main contact</span>
                  <select name="lead_person_id" defaultValue={household.lead_person_id ?? ""} className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2">
                    {relatives.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.first_name} {f.last_name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="hidden sm:block" />
                <FormButtons base={base} section="family">Save main contact</FormButtons>
              </form>
            ) : (
              canAddToFamily && (
                <Link href={`/admin/members/new?household=${household.id}`} className={`mt-3 inline-block ${LINK}`}>
                  Add a new member to this family
                </Link>
              )
            )}
          </>
        )}
      </Card>

      <Card id="boats" title="Boat storage" action={edit("boats", "boat storage")}>
        {messages("boats")}
        {boats.length === 0 ? (
          <p className="text-sm text-slate-600">No boats stored.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {boats.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-4 py-2">
                <span>
                  <strong>
                    {b.boat_class} {b.sail_number}
                  </strong>
                  : {pounds(b.price_pence)}
                  {b.boat_storage_options?.members_rate === false && " (non-members rate)"}, {STATUS_LABEL[b.status] ?? b.status}
                  <span className="block text-sm text-slate-500">{typeDates(b)}</span>
                </span>
                {editing === "boats" && b.status === "awaiting_payment" && (
                  <form action={adminRemoveBoat}>
                    <input type="hidden" name="id" value={b.id} />
                    <input type="hidden" name="person_id" value={m.id} />
                    <SaveButton variant="link" pendingText="Removing…" aria-label={`Remove ${b.boat_class} ${b.sail_number}`}>
                      Remove
                    </SaveButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {editing === "boats" && (
          <form action={adminAddBoat} aria-label="Add a boat" className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={m.id} />
            <Field label="Class" name="boat_class" required hint="For example Laser" />
            <Field label="Sail number" name="sail_number" required />
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">Rate</span>
              <select name="rate" defaultValue="members" className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2">
                <option value="members">Members rate: {pounds(ratePrice(true))}</option>
                <option value="non_members">Non-members rate (didn&apos;t renew but left their boat): {pounds(ratePrice(false))}</option>
              </select>
            </label>
            <Field label="Stored from" name="starts_on" type="date" required defaultValue={`${thisYear}-01-01`} />
            <Field label="Stored until" name="ends_on" type="date" required defaultValue={`${thisYear}-12-31`} />
            <label className="block">
              <span className="text-sm font-medium">Payment received</span>
              <select name="payment_method" defaultValue="" className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2">
                <option value="">Not yet (awaiting payment)</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>
            <Field label="Date received" name="paid_on" type="date" defaultValue={ukToday()} />
            <FormButtons base={base} section="boats" cancelText="Done" wide>
              Add boat
            </FormButtons>
          </form>
        )}
      </Card>

      {household && (
        <Card id="address" title="Home address" action={edit("address", "home address")}>
          {messages("address")}
          {editing === "address" ? (
            <form action={adminSaveAddress} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="person_id" value={m.id} />
              <input type="hidden" name="household_id" value={household.id} />
              <Field label="Address line 1" name="address_line1" defaultValue={household.address_line1} />
              <Field label="Address line 2" name="address_line2" defaultValue={household.address_line2} />
              <Field label="Town" name="address_line3" defaultValue={household.address_line3} />
              <Field label="County" name="address_line4" defaultValue={household.address_line4} />
              <Field label="Postcode" name="postcode" defaultValue={household.postcode} />
              <FormButtons base={base} section="address">Save address</FormButtons>
            </form>
          ) : addressLines.length ? (
            <address className="not-italic text-slate-800">
              {addressLines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </address>
          ) : (
            <p className="text-slate-600">No address recorded.</p>
          )}
        </Card>
      )}

      <Card id="medical" title="Medical information" action={edit("medical", "medical information")}>
        {messages("medical")}
        <p className="mb-4 text-sm text-slate-600">
          Every time someone views medical information it is recorded, with who looked and when. Opening it to edit counts as a view.
        </p>
        {editing === "medical" ? (
          <form action={adminSaveMedical} className="space-y-3">
            <input type="hidden" name="id" value={m.id} />
            <label className="block">
              <span className="text-sm font-medium">Medical details</span>
              <textarea
                name="details"
                rows={4}
                defaultValue={medical?.details ?? ""}
                className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"
              />
              <span className="mt-1 block text-xs text-slate-500">Only add this with the member&apos;s (or their parent&apos;s) agreement.</span>
            </label>
            <FormButtons base={base} section="medical">Save medical information</FormButtons>
          </form>
        ) : showMedical ? (
          medical?.details ? (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap">{medical.details}</p>
              <p className="text-xs text-slate-500">Last updated {ukDate(medical.updated_at)}. Your view has been recorded.</p>
            </div>
          ) : (
            <p className="text-slate-600">No medical information recorded. Your view has been recorded.</p>
          )
        ) : (
          <form method="get" action={`${base}#medical`}>
            <input type="hidden" name="medical" value="show" />
            <SaveButton variant="secondary">Show medical information</SaveButton>
          </form>
        )}
      </Card>

      <Card id="qualifications" title="Qualifications" action={edit("qualifications", "qualifications")}>
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
                  <form action={adminRemoveQualification}>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="person_id" value={m.id} />
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
          <form action={adminAddQualification} className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
            <input type="hidden" name="id" value={m.id} />
            <Field label="Qualification" name="name" required hint="For example RYA Dinghy Level 2" />
            <Field label="Awarded" name="awarded_on" type="date" />
            <Field label="Expires" name="expires_on" type="date" />
            <FormButtons base={base} section="qualifications" cancelText="Done" wide>
              Add qualification
            </FormButtons>
          </form>
        )}
      </Card>

      <Card id="preferences" title="Communication preferences" action={edit("preferences", "communication preferences")}>
        {messages("preferences")}
        {editing === "preferences" ? (
          <form action={adminSavePreferences} className="space-y-3">
            <input type="hidden" name="id" value={m.id} />
            <p className="text-sm text-slate-600">Only change these when the member has asked you to.</p>
            <Checkbox label="Club news and newsletters by email" name="news_consent" defaultChecked={m.news_consent} />
            <Checkbox label="Listed in the member directory (name, phone and email)" name="directory_listed" defaultChecked={!m.directory_opt_out} />
            <FormButtons base={base} section="preferences">Save preferences</FormButtons>
          </form>
        ) : (
          <ul className="space-y-1 text-slate-800">
            <li>Club news by email: {m.news_consent ? "yes" : "no"}</li>
            <li>Listed in the member directory: {m.directory_opt_out ? "no" : "yes"}</li>
          </ul>
        )}
      </Card>
    </div>
  );
}
