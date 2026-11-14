"use server";

import { redirect } from "next/navigation";
import { cleanHandbookHtml } from "@/lib/handbook";
import { meWithRole } from "@/lib/me";

// Admins save a handbook section's text. The text is cleaned so only simple formatting is kept.
export async function saveHandbookSection(form: FormData) {
  const slug = String(form.get("slug") ?? "");
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed) redirect("/handbook");
  const body = cleanHandbookHtml(String(form.get("body") ?? ""));
  const { data, error } = await supabase
    .from("handbook_sections")
    .update({ body, updated_by: personId })
    .eq("slug", slug)
    .select("slug");
  if (error || !data?.length) redirect(`/handbook/${encodeURIComponent(slug)}/edit?error=save`);
  redirect(`/handbook?saved=${encodeURIComponent(slug)}#${encodeURIComponent(slug)}`);
}
