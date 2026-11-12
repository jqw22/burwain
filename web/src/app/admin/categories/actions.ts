"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";

function back(key: "saved" | "error", value: string): never {
  redirect(`/admin/categories?${key}=${value}`);
}

const direction = (form: FormData) => (form.get("direction") === "in" ? "in" : form.get("direction") === "out" ? "out" : null);

export async function addCategory(form: FormData) {
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) back("error", "finance");
  const name = text(form, "name");
  const dir = direction(form);
  if (!name) back("error", "name");
  if (!dir) back("error", "direction");
  const { error } = await supabase.from("transaction_categories").insert({ name, direction: dir });
  if (error) back("error", error.code === "23505" ? "duplicate" : "save");
  back("saved", "added");
}

export async function renameCategory(form: FormData) {
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) back("error", "finance");
  const id = String(form.get("id") ?? "");
  const name = text(form, "name");
  if (!name) back("error", "name");
  const { error } = await supabase.from("transaction_categories").update({ name }).eq("id", id);
  if (error) back("error", error.code === "23505" ? "duplicate" : error.message.includes("used automatically") ? "locked" : "save");
  back("saved", "renamed");
}

export async function setCategoryActive(form: FormData) {
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) back("error", "finance");
  const id = String(form.get("id") ?? "");
  const active = form.get("active") === "true";
  const { error } = await supabase.from("transaction_categories").update({ is_active: active }).eq("id", id);
  if (error) back("error", error.message.includes("used automatically") ? "locked" : "save");
  back("saved", active ? "activated" : "deactivated");
}
