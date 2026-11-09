"use server";

import { redirect } from "next/navigation";
import { requireMe, text } from "@/lib/me";

export async function saveAddress(form: FormData) {
  const { supabase } = await requireMe();
  const householdId = String(form.get("household_id"));
  const { error } = await supabase
    .from("households")
    .update({
      address_line1: text(form, "address_line1"),
      address_line2: text(form, "address_line2"),
      address_line3: text(form, "address_line3"),
      address_line4: text(form, "address_line4"),
      postcode: text(form, "postcode")?.toUpperCase() ?? null,
    })
    .eq("id", householdId);
  redirect(error ? "/family?error=address" : "/family?saved=address");
}

export async function addFamilyMember(form: FormData) {
  const { supabase } = await requireMe();
  const first = text(form, "first_name");
  const last = text(form, "last_name");
  if (!first || !last) redirect("/family?error=add");
  const { error } = await supabase.from("people").insert({
    household_id: String(form.get("household_id")),
    first_name: first,
    last_name: last,
    date_of_birth: text(form, "date_of_birth"),
    email: text(form, "email")?.toLowerCase() ?? null,
    mobile: text(form, "mobile"),
  });
  redirect(error ? "/family?error=add" : "/family?saved=add");
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
  redirect(error ? `/family/${id}?error=1` : "/family?saved=member");
}
