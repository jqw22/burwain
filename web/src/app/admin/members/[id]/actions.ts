"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";

// Each save goes back to the box it came from, with a message inside it.
function back(id: string, key: "saved" | "error", section: string, anchor: string, editAgain = false): never {
  redirect(`/admin/members/${id}?${key}=${section}${editAgain ? `&edit=${anchor}` : ""}#${anchor}`);
}

export async function adminSaveMember(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("id"));
  if (!allowed) back(id, "error", "details", "contact", true);
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
      first_joined_on: text(form, "first_joined_on"),
    })
    .eq("id", id);
  back(id, error ? "error" : "saved", "details", "contact", Boolean(error));
}

export async function adminSaveAddress(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("person_id"));
  if (!allowed) back(id, "error", "address", "address", true);
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
  back(id, error ? "error" : "saved", "address", "address", Boolean(error));
}

export async function adminSaveLead(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("person_id"));
  if (!allowed) back(id, "error", "lead", "family", true);
  const { error } = await supabase
    .from("households")
    .update({ lead_person_id: text(form, "lead_person_id") })
    .eq("id", String(form.get("household_id")));
  back(id, error ? "error" : "saved", "lead", "family", Boolean(error));
}

export async function adminSaveMedical(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("id"));
  if (!allowed) back(id, "error", "medical", "medical", true);
  const { error } = await supabase.rpc("admin_save_medical", { p_person: id, p_details: text(form, "details") ?? "" });
  redirect(`/admin/members/${id}?${error ? "error=medical&edit=medical" : "saved=medical&medical=show"}#medical`);
}

export async function adminAddQualification(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("id"));
  const name = text(form, "name");
  if (!allowed || !name) back(id, "error", "qualification", "qualifications", true);
  const { error } = await supabase.from("qualifications").insert({
    person_id: id,
    name,
    awarded_on: text(form, "awarded_on"),
    expires_on: text(form, "expires_on"),
  });
  back(id, error ? "error" : "saved", "qualification", "qualifications", true);
}

export async function adminRemoveQualification(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("person_id"));
  if (!allowed) back(id, "error", "qualification", "qualifications", true);
  const { error } = await supabase.from("qualifications").delete().eq("id", String(form.get("id")));
  back(id, error ? "error" : "saved", "qualification", "qualifications", true);
}

export async function adminSavePreferences(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("id"));
  if (!allowed) back(id, "error", "preferences", "preferences", true);
  const consent = form.get("news_consent") === "on";
  const groupEmails = form.get("group_emails") === "on";
  const { data: before } = await supabase
    .from("people")
    .select("news_consent, emails_unsubscribed_at")
    .eq("id", id)
    .single<{ news_consent: boolean; emails_unsubscribed_at: string | null }>();
  const { error } = await supabase
    .from("people")
    .update({
      news_consent: consent,
      // Record when consent was given (admins bypass the trigger that normally does this).
      ...(before?.news_consent !== consent ? { news_consent_at: consent ? new Date().toISOString() : null } : {}),
      directory_opt_out: form.get("directory_listed") !== "on",
      // Unsubscribed from group emails (keeps the original date if they were already).
      emails_unsubscribed_at: groupEmails ? null : (before?.emails_unsubscribed_at ?? new Date().toISOString()),
    })
    .eq("id", id);
  back(id, error ? "error" : "saved", "preferences", "preferences", Boolean(error));
}

// An admin renews (or adds) a membership for this member and/or their family.
export async function adminRenewMembership(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("member_id"));
  if (!allowed) back(id, "error", "renew", "membership");
  const people = form.getAll("person").map(String);
  if (people.length === 0) back(id, "error", "who", "membership");
  const { error } = await supabase.rpc("admin_renew_membership", {
    p_person: id,
    p_type_id: String(form.get("type_id") ?? ""),
    p_person_ids: people,
  });
  if (error) {
    const known: [string, string][] = [
      ["age limit", "age"],
      ["already has", "duplicate"],
      ["junior needs an adult", "adult"],
      ["covers exactly", "count"],
      ["up to 4", "count"],
      ["not available", "unavailable"],
    ];
    back(id, "error", known.find(([n]) => error.message.includes(n))?.[1] ?? "renew", "membership");
  }
  back(id, "saved", "renewed", "membership");
}

// Boat storage: add a boat at the members or non-members rate, optionally with a cash, cheque or
// bank transfer payment (which posts the income), or remove one that hasn't been paid for.
export async function adminAddBoat(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("id"));
  if (!allowed) back(id, "error", "boats", "boats", true);
  const method = text(form, "payment_method");
  const { error } = await supabase.rpc("admin_add_boat_storage", {
    p_person: id,
    p_members: form.get("rate") !== "non_members",
    p_class: text(form, "boat_class") ?? "",
    p_sail: text(form, "sail_number") ?? "",
    p_starts: text(form, "starts_on"),
    p_ends: text(form, "ends_on"),
    p_method: method,
    p_paid_on: method ? text(form, "paid_on") : null,
  });
  back(id, error ? "error" : "saved", "boats", "boats", true);
}

export async function adminRemoveBoat(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("person_id"));
  if (!allowed) back(id, "error", "boatremove", "boats", true);
  const { error } = await supabase.rpc("admin_remove_boat_storage", { p_id: String(form.get("id")) });
  if (error) back(id, "error", "boatremove", "boats", true);
  back(id, "saved", "boats", "boats", true);
}
