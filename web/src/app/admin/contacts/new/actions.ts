"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";

export async function addContact(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) redirect("/admin/contacts/new?error=admin");
  const { data, error } = await supabase.rpc("admin_add_contact", {
    p: {
      first_name: text(form, "first_name"),
      last_name: text(form, "last_name"),
      email: text(form, "email"),
      mobile: text(form, "mobile"),
      news_consent: form.get("news_consent") === "on",
    },
  });
  if (error) {
    const key = error.message.includes("already uses") ? "email" : error.message.includes("name") ? "name" : error.message.includes("email") ? "noemail" : "save";
    redirect(`/admin/contacts/new?error=${key}`);
  }
  redirect(`/admin/members/${data}?saved=contact`);
}
