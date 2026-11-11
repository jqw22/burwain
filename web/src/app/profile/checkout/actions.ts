"use server";

import { redirect } from "next/navigation";
import { requireMe } from "@/lib/me";

// Test checkout only: no payment provider is called, no money is taken and nothing in the
// database changes. Card (Stripe) and Direct Debit (GoCardless) will replace this later.
export async function payTest(form: FormData) {
  await requireMe();
  const method = form.get("method") === "direct_debit" ? "direct_debit" : "card";
  const total = Number(form.get("total") ?? 0);
  redirect(`/profile/checkout?paid=${Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0}&method=${method}`);
}
