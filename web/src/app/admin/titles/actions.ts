"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";

// Club titles: superadmins only (the database checks too). Titles are never deleted, only made inactive.
export async function saveTitle(form: FormData) {
  const { supabase, allowed } = await meWithRole("superadmin");
  if (!allowed) redirect("/admin/titles?error=save");
  const name = (text(form, "name") ?? "").replace(/\s+/g, " ");
  const order = Number(text(form, "sort_order") ?? "100");
  if (!name || !Number.isInteger(order)) redirect("/admin/titles?error=save");
  const id = text(form, "id");
  const { error } = id
    ? await supabase.from("club_titles").update({ name, sort_order: order }).eq("id", id)
    : await supabase.from("club_titles").insert({ name, sort_order: order });
  if (error) redirect(`/admin/titles?error=${error.code === "23505" ? "duplicate" : "save"}`);
  redirect(`/admin/titles?saved=${id ? "saved" : "added"}`);
}

export async function setTitleActive(form: FormData) {
  const { supabase, allowed } = await meWithRole("superadmin");
  if (!allowed) redirect("/admin/titles?error=save");
  const { error } = await supabase
    .from("club_titles")
    .update({ is_active: form.get("active") === "true" })
    .eq("id", String(form.get("id")));
  redirect(error ? "/admin/titles?error=save" : "/admin/titles?saved=saved");
}
