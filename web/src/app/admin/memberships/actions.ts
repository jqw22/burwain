"use server";

import { redirect } from "next/navigation";
import { meWithRole } from "@/lib/me";

function back(key: "saved" | "error", value: string): never {
  redirect(`/admin/memberships?${key}=${value}`);
}

export async function recordPayment(form: FormData) {
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) back("error", "finance");
  const ids = form.getAll("membership_id").map(String).filter(Boolean);
  if (ids.length === 0) back("error", "choose");
  const { error } = await supabase.rpc("record_manual_payment", {
    p_membership_ids: ids,
    p_method: String(form.get("method")),
    p_paid_on: String(form.get("paid_on")),
  });
  back(error ? "error" : "saved", error ? "payment" : "paid");
}

// The Reconciled tick on a payment line: finance confirms the money is in the bank and entered as a transaction.
export async function setReconciled(form: FormData) {
  const query = String(form.get("back") ?? "");
  const again = (extra: string): never => redirect(`/admin/memberships?${query}${query && extra ? "&" : ""}${extra}`);
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) again("error=finance");
  const { error } = await supabase.rpc("set_receipt_line_reconciled", {
    p_line: String(form.get("line") ?? ""),
    p_reconciled: form.get("reconciled") === "1",
  });
  again(error ? "error=reconcile" : "");
}
