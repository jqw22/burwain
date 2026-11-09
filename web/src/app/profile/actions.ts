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
  redirect(error ? "/profile?error=details" : "/profile?saved=details");
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
  redirect(error ? "/profile?error=preferences" : "/profile?saved=preferences");
}

export async function saveMedical(form: FormData) {
  const { supabase, personId } = await requireMe();
  const details = text(form, "details");
  if (details && form.get("consent") !== "on") {
    redirect("/profile?error=consent");
  }
  const { error } = details
    ? await supabase
        .from("medical_records")
        .upsert({ person_id: personId, details, consent_given_at: new Date().toISOString(), updated_by: personId })
    : await supabase.from("medical_records").delete().eq("person_id", personId);
  redirect(error ? "/profile?error=medical" : "/profile?saved=medical");
}

export async function addQualification(form: FormData) {
  const { supabase, personId } = await requireMe();
  const name = text(form, "name");
  if (!name) redirect("/profile?error=qualification");
  const { error } = await supabase.from("qualifications").insert({
    person_id: personId,
    name,
    awarded_on: text(form, "awarded_on"),
    expires_on: text(form, "expires_on"),
  });
  redirect(error ? "/profile?error=qualification" : "/profile?saved=qualification");
}

export async function removeQualification(form: FormData) {
  const { supabase } = await requireMe();
  const { error } = await supabase.from("qualifications").delete().eq("id", String(form.get("id")));
  redirect(error ? "/profile?error=qualification" : "/profile?saved=qualification");
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
  redirect(error ? "/profile?error=address" : "/profile?saved=address");
}

export async function addFamilyMember(form: FormData) {
  const { supabase } = await requireMe();
  const first = text(form, "first_name");
  const last = text(form, "last_name");
  if (!first || !last) redirect("/profile?error=add");
  const { error } = await supabase.from("people").insert({
    household_id: String(form.get("household_id")),
    first_name: first,
    last_name: last,
    date_of_birth: text(form, "date_of_birth"),
    email: text(form, "email")?.toLowerCase() ?? null,
    mobile: text(form, "mobile"),
  });
  redirect(error ? "/profile?error=add" : "/profile?saved=add");
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
