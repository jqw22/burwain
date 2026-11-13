"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";
import { PURPOSES, unknownPlaceholders } from "@/lib/email";

function back(key: "saved" | "error", value: string, edit?: string): never {
  redirect(`/admin/emails?${key}=${value}${edit ? `&edit=${encodeURIComponent(edit)}` : ""}`);
}

export async function saveTemplate(form: FormData) {
  const id = String(form.get("id") ?? "");
  const edit = id || "new";
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed) back("error", "admin");

  const name = text(form, "name");
  const subject = text(form, "subject");
  const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n").trim();
  const purpose = String(form.get("purpose"));
  if (!name) back("error", "name", edit);
  if (!subject) back("error", "subject", edit);
  if (!body) back("error", "body", edit);
  if (!(purpose in PURPOSES)) back("error", "save", edit);
  if (unknownPlaceholders(`${subject} ${body}`).length > 0) back("error", "placeholder", edit);

  const row = { name, subject, body, purpose, updated_by: personId };
  const { error } = id
    ? await supabase.from("email_templates").update(row).eq("id", id)
    : await supabase.from("email_templates").insert(row);
  if (error) {
    const clash = error.code === "23505";
    back("error", clash ? "duplicate" : "save", edit);
  }
  back("saved", id ? "updated" : "added");
}
