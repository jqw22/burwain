"use server";

import { redirect } from "next/navigation";
import { requireMe, text } from "@/lib/me";

export async function saveDetails(form: FormData) {
  const { supabase, personId } = await requireMe();
  const { error } = await supabase
    .from("people")
    .update({
      title: text(form, "title"),
      first_name: text(form, "first_name") ?? "",
      last_name: text(form, "last_name") ?? "",
      date_of_birth: text(form, "date_of_birth"),
      email: text(form, "email")?.toLowerCase() ?? null,
      mobile: text(form, "mobile"),
      whatsapp: form.get("whatsapp") === "on",
      emergency_contact_name: text(form, "emergency_contact_name"),
      emergency_contact_mobile: text(form, "emergency_contact_mobile"),
    })
    .eq("id", personId);
  redirect(error ? "/profile?edit=contact&error=details#contact" : "/profile?saved=details#contact");
}

export async function savePreferences(form: FormData) {
  const { supabase, personId } = await requireMe();
  const { error } = await supabase
    .from("people")
    .update({
      news_consent: form.get("news_consent") === "on",
      directory_opt_out: form.get("directory_listed") !== "on",
    })
    .eq("id", personId);
  redirect(error ? "/profile?edit=preferences&error=preferences#preferences" : "/profile?saved=preferences#preferences");
}

export async function saveMedical(form: FormData) {
  const { supabase, personId } = await requireMe();
  const details = text(form, "details");
  if (details && form.get("consent") !== "on") {
    redirect("/profile?edit=medical&error=consent#medical");
  }
  const { error } = details
    ? await supabase
        .from("medical_records")
        .upsert({ person_id: personId, details, consent_given_at: new Date().toISOString(), updated_by: personId })
    : await supabase.from("medical_records").delete().eq("person_id", personId);
  redirect(error ? "/profile?edit=medical&error=medical#medical" : "/profile?saved=medical#medical");
}

export async function addQualification(form: FormData) {
  const { supabase, personId } = await requireMe();
  const name = text(form, "name");
  if (!name) redirect("/profile?edit=qualifications&error=qualification#qualifications");
  const { error } = await supabase.from("qualifications").insert({
    person_id: personId,
    name,
    awarded_on: text(form, "awarded_on"),
    expires_on: text(form, "expires_on"),
  });
  redirect(`/profile?edit=qualifications&${error ? "error" : "saved"}=qualification#qualifications`);
}

export async function removeQualification(form: FormData) {
  const { supabase } = await requireMe();
  const { error } = await supabase.from("qualifications").delete().eq("id", String(form.get("id")));
  redirect(`/profile?edit=qualifications&${error ? "error" : "saved"}=qualification#qualifications`);
}

// Family (the main contact only; row-level security enforces this).

export async function saveAddress(form: FormData) {
  const { supabase } = await requireMe();
  const { error } = await supabase
    .from("households")
    .update({
      address_line1: text(form, "address_line1"),
      address_line2: text(form, "address_line2"),
      address_line3: text(form, "address_line3"),
      address_line4: text(form, "address_line4"),
      postcode: text(form, "postcode")?.toUpperCase() ?? null,
    })
    .eq("id", String(form.get("household_id")));
  redirect(error ? "/profile?edit=address&error=address#address" : "/profile?saved=address#address");
}

export async function addFamilyMember(form: FormData) {
  const { supabase } = await requireMe();
  const first = text(form, "first_name");
  const last = text(form, "last_name");
  if (!first || !last) redirect("/profile?edit=family&error=add#family");
  const { error } = await supabase.from("people").insert({
    household_id: String(form.get("household_id")),
    first_name: first,
    last_name: last,
    date_of_birth: text(form, "date_of_birth"),
    email: text(form, "email")?.toLowerCase() ?? null,
    mobile: text(form, "mobile"),
    whatsapp: form.get("whatsapp") === "on",
  });
  redirect(error ? "/profile?edit=family&error=add#family" : "/profile?edit=family&saved=add#family");
}

export async function saveFamilyMember(form: FormData) {
  const { supabase } = await requireMe();
  const id = String(form.get("id"));
  const { error } = await supabase
    .from("people")
    .update({
      first_name: text(form, "first_name") ?? "",
      last_name: text(form, "last_name") ?? "",
      date_of_birth: text(form, "date_of_birth"),
      email: text(form, "email")?.toLowerCase() ?? null,
      mobile: text(form, "mobile"),
      whatsapp: form.get("whatsapp") === "on",
      emergency_contact_name: text(form, "emergency_contact_name"),
      emergency_contact_mobile: text(form, "emergency_contact_mobile"),
    })
    .eq("id", id);
  redirect(`/profile/member/${id}?${error ? "error" : "saved"}=details`);
}

export async function saveFamilyMedical(form: FormData) {
  const { supabase, personId } = await requireMe();
  const id = String(form.get("id"));
  const details = text(form, "details");
  if (details && form.get("consent") !== "on") redirect(`/profile/member/${id}?error=consent`);
  const { error } = details
    ? await supabase
        .from("medical_records")
        .upsert({ person_id: id, details, consent_given_at: new Date().toISOString(), updated_by: personId })
    : await supabase.from("medical_records").delete().eq("person_id", id);
  redirect(`/profile/member/${id}?${error ? "error" : "saved"}=medical`);
}

export async function addFamilyQualification(form: FormData) {
  const { supabase } = await requireMe();
  const id = String(form.get("id"));
  const name = text(form, "name");
  if (!name) redirect(`/profile/member/${id}?error=qualification`);
  const { error } = await supabase.from("qualifications").insert({
    person_id: id,
    name,
    awarded_on: text(form, "awarded_on"),
    expires_on: text(form, "expires_on"),
  });
  redirect(`/profile/member/${id}?${error ? "error" : "saved"}=qualification`);
}

export async function removeFamilyQualification(form: FormData) {
  const { supabase } = await requireMe();
  const id = String(form.get("person_id"));
  const { error } = await supabase.from("qualifications").delete().eq("id", String(form.get("id")));
  redirect(`/profile/member/${id}?${error ? "error" : "saved"}=qualification`);
}

export async function saveFamilyPreferences(form: FormData) {
  const { supabase } = await requireMe();
  const id = String(form.get("id"));
  const { error } = await supabase
    .from("people")
    .update({
      news_consent: form.get("news_consent") === "on",
      directory_opt_out: form.get("directory_listed") !== "on",
    })
    .eq("id", id);
  redirect(`/profile/member/${id}?${error ? "error" : "saved"}=preferences`);
}

export async function createHousehold(form: FormData) {
  const { supabase } = await requireMe();
  const { error } = await supabase.rpc("create_my_household", {
    p_address_line1: text(form, "address_line1") ?? "",
    p_address_line2: text(form, "address_line2") ?? "",
    p_address_line3: text(form, "address_line3") ?? "",
    p_address_line4: text(form, "address_line4") ?? "",
    p_postcode: text(form, "postcode") ?? "",
  });
  redirect(error ? "/profile?error=household#family" : "/profile?saved=household#family");
}

// Database messages about memberships we can explain. Anything else gets a general message.
const MEMBERSHIP_ERRORS: [string, string][] = [
  ["Choose who", "who"],
  ["own household", "household"],
  ["covers exactly one", "one"],
  ["covers exactly two", "two"],
  ["age limit", "age"],
  ["junior needs an adult", "adult"],
  ["already has", "duplicate"],
  ["not open", "closed"],
  ["not available", "unavailable"],
];
function membershipError(message: string) {
  return MEMBERSHIP_ERRORS.find(([needle]) => message.includes(needle))?.[1] ?? "renew";
}

// Renew this year's memberships for next year, same types and people. Adults come first in the form.
export async function renewMemberships(form: FormData) {
  const { supabase } = await requireMe();
  const yearId = String(form.get("club_year_id") ?? "");
  for (const item of form.getAll("renew").map(String)) {
    const [typeId, people] = item.split(":");
    const { error } = await supabase.rpc("start_membership", {
      p_type_id: typeId,
      p_person_ids: people.split(",").filter(Boolean),
      p_club_year_id: yearId,
    });
    if (error) redirect(`/profile?error=${membershipError(error.message)}#renew`);
  }
  redirect("/profile?saved=renewed#renew");
}

// Renew on a different membership type (a junior who has turned 18, say).
export async function chooseRenewal(form: FormData) {
  const { supabase } = await requireMe();
  const people = form.getAll("person_id").map(String);
  if (people.length === 0) redirect("/profile?edit=renew&error=who#renew");
  const { error } = await supabase.rpc("start_membership", {
    p_type_id: String(form.get("type_id") ?? ""),
    p_person_ids: people,
    p_club_year_id: String(form.get("club_year_id") ?? ""),
  });
  redirect(error ? `/profile?edit=renew&error=${membershipError(error.message)}#renew` : "/profile?saved=renewed#renew");
}
