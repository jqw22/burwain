"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";

function back(year: string, key: "saved" | "error", value: string, edit?: string): never {
  const y = year ? `year=${encodeURIComponent(year)}&` : "";
  redirect(`/admin/types?${y}${key}=${value}${edit ? `&edit=${encodeURIComponent(edit)}` : ""}`);
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
  const year = String(form.get("year") ?? "");
  const yearId = String(form.get("club_year_id") ?? "");
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) back(year, "error", "admin");

  const name = text(form, "name");
  const code = (text(form, "code") ?? "").toUpperCase();
  const price = pence(text(form, "price"));
  const maxAge = whole(text(form, "max_age"));
  const sibling = whole(text(form, "sibling_order"));
  const sort = whole(text(form, "sort_order"));
  if (!name) back(year, "error", "name", edit);
  if (!/^[A-Z0-9]{1,10}$/.test(code)) back(year, "error", "code", edit);
  if (price === null) back(year, "error", "price", edit);
  if (Number.isNaN(maxAge) || (maxAge !== null && maxAge > 120)) back(year, "error", "age", edit);
  if (Number.isNaN(sibling) || (sibling !== null && (sibling < 1 || sibling > 9))) back(year, "error", "sibling", edit);
  if (Number.isNaN(sort)) back(year, "error", "order", edit);
  const startsOn = text(form, "starts_on");
  const endsOn = text(form, "ends_on");
  const isDate = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!isDate(startsOn) || !isDate(endsOn) || endsOn! < startsOn!) back(year, "error", "dates", edit);

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
    is_open: form.get("is_open") === "on",
    sort_order: sort ?? 0,
    starts_on: startsOn,
    ends_on: endsOn,
  };

  const { error } = id
    ? await supabase.from("membership_types").update(row).eq("id", id)
    : await supabase.from("membership_types").insert({ ...row, club_year_id: yearId });
  if (error)
    back(year, "error", error.code === "23505" ? "duplicate" : error.message.includes("already has memberships") ? "moved" : "save", edit);
  // Show the year the type now starts in.
  back(startsOn!.slice(0, 4), "saved", id ? "updated" : "added");
}

export async function setActive(form: FormData) {
  const year = String(form.get("year") ?? "");
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) back(year, "error", "admin");
  const active = form.get("active") === "true";
  const { error } = await supabase.from("membership_types").update({ is_open: active }).eq("id", String(form.get("id")));
  back(year, error ? "error" : "saved", error ? "save" : active ? "activated" : "deactivated");
}

// Copy this year's types into the next year (creating that year if needed), then show the next year.
export async function copyToNextYear(form: FormData) {
  const year = String(form.get("year") ?? "");
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) back(year, "error", "admin");
  const { data, error } = await supabase.rpc("copy_membership_types", { p_from_year: String(form.get("club_year_id")) });
  if (error) back(year, "error", "copy");
  redirect(`/admin/types?year=${Number(year) + 1}&saved=copied&count=${Number(data ?? 0)}`);
}
