"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";

export async function adminSaveMember(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("id"));
  if (!allowed) redirect(`/admin/members/${id}?error=save`);
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
  redirect(`/admin/members/${id}?${error ? "error" : "saved"}=details`);
}

export async function adminSaveAddress(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  const id = String(form.get("person_id"));
  if (!allowed) redirect(`/admin/members/${id}?error=save`);
  const { error } = await supabase
    .from("households")
    .update({
      address_line1: text(form, "address_line1"),
      address_line2: text(form, "address_line2"),
      address_line3: text(form, "address_line3"),
      address_line4: text(form, "address_line4"),
      postcode: text(form, "postcode")?.toUpperCase() ?? null,
      lead_person_id: text(form, "lead_person_id"),
    })
    .eq("id", String(form.get("household_id")));
  redirect(`/admin/members/${id}?${error ? "error" : "saved"}=address`);
}
