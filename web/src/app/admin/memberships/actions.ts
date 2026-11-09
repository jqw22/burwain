"use server";

import { redirect } from "next/navigation";
import { meWithRole } from "@/lib/me";

function back(year: string, key: "saved" | "error", value: string): never {
  redirect(`/admin/memberships?year=${encodeURIComponent(year)}&${key}=${value}`);
}

export async function approveMembership(form: FormData) {
  const year = String(form.get("year") ?? "");
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) back(year, "error", "approve");
  const { error } = await supabase.rpc("approve_membership", { p_membership: String(form.get("id")) });
  back(year, error ? "error" : "saved", "approved");
}

export async function recordPayment(form: FormData) {
  const year = String(form.get("year") ?? "");
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) back(year, "error", "finance");
  const ids = form.getAll("membership_id").map(String).filter(Boolean);
  if (ids.length === 0) back(year, "error", "choose");
  const { error } = await supabase.rpc("record_manual_payment", {
    p_membership_ids: ids,
    p_method: String(form.get("method")),
    p_paid_on: String(form.get("paid_on")),
  });
  back(year, error ? "error" : "saved", error ? "payment" : "paid");
}
