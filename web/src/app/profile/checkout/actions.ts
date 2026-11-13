"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMe } from "@/lib/me";

// Test checkout: no payment provider is called and no money is taken, but the payment is
// recorded (as a test) and the memberships are marked as paid. Card (Stripe) and
// Direct Debit (GoCardless) will replace this later.
export async function payTest(form: FormData) {
  const { supabase } = await requireMe();
  const method = form.get("method") === "direct_debit" ? "direct_debit" : "card";
  const ids = form.getAll("membership_id").map(String).filter(Boolean);
  const { data: receiptId, error } = await supabase.rpc("pay_my_memberships_test", { p_membership_ids: ids, p_method: method });
  if (error) redirect(`/profile/checkout?error=1`);
  revalidatePath("/profile");
  redirect(`/profile/checkout?receipt=${receiptId}`);
}
