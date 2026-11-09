"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";

function back(key: "saved" | "error", value: string, edit?: string): never {
  redirect(`/admin/types?${key}=${value}${edit ? `&edit=${encodeURIComponent(edit)}` : ""}`);
}

// "£95", "95.50" or "95" become pence; anything else is null.
function pence(value: string | null) {
  if (!value) return null;
  const m = value.replace(/[£,\s]/g, "").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

function whole(value: string | null) {
  if (!value) return null;
  return /^\d+$/.test(value) ? Number(value) : NaN;
}

export async function saveType(form: FormData) {
  const id = String(form.get("id") ?? "");
  const edit = id || "new";
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) back("error", "admin");

  const name = text(form, "name");
  const code = (text(form, "code") ?? "").toUpperCase();
  const price = pence(text(form, "price"));
  const maxAge = whole(text(form, "max_age"));
  const sibling = whole(text(form, "sibling_order"));
  const sort = whole(text(form, "sort_order"));
  if (!name) back("error", "name", edit);
  if (!/^[A-Z0-9]{1,10}$/.test(code)) back("error", "code", edit);
  if (price === null) back("error", "price", edit);
  if (Number.isNaN(maxAge) || (maxAge !== null && maxAge > 120)) back("error", "age", edit);
  if (Number.isNaN(sibling) || (sibling !== null && (sibling < 1 || sibling > 9))) back("error", "sibling", edit);
  if (Number.isNaN(sort)) back("error", "order", edit);

  const row = {
    name,
    code,
    description: text(form, "description"),
    category: String(form.get("category")) === "non_sailing" ? "non_sailing" : "sailing",
    cover: ["individual", "dual", "family", "junior"].includes(String(form.get("cover"))) ? String(form.get("cover")) : "individual",
    annual_price_pence: price,
    max_age: maxAge,
    sibling_order: sibling,
    requires_adult_member: form.get("requires_adult_member") === "on",
    requires_approval: form.get("requires_approval") === "on",
    is_open: form.get("is_open") === "on",
    sort_order: sort ?? 0,
  };

  const { error } = id
    ? await supabase.from("membership_types").update(row).eq("id", id)
    : await supabase.from("membership_types").insert(row);
  if (error) back("error", error.code === "23505" ? "duplicate" : "save", edit);
  back("saved", id ? "updated" : "added");
}

export async function setActive(form: FormData) {
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) back("error", "admin");
  const active = form.get("active") === "true";
  const { error } = await supabase.from("membership_types").update({ is_open: active }).eq("id", String(form.get("id")));
  back(error ? "error" : "saved", error ? "save" : active ? "activated" : "deactivated");
}
