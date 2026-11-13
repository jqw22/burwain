"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { boatsFromForm } from "@/lib/boats";
import { requireMe } from "@/lib/me";

// Test checkout: no payment provider is called and no money is taken, but the payment is
// recorded and the memberships and boat storage are marked as paid. Card (Stripe) and
// Direct Debit (GoCardless) will replace this later.
export async function payTest(form: FormData) {
  const { supabase } = await requireMe();
  const method = form.get("method") === "direct_debit" ? "direct_debit" : "card";
  const ids = form.getAll("membership_id").map(String).filter(Boolean);
  const storageIds = form.getAll("storage_id").map(String).filter(Boolean);
  const { data: receiptId, error } = await supabase.rpc("pay_my_memberships_test", {
    p_membership_ids: ids,
    p_method: method,
    p_boats: boatsFromForm(form),
    p_storage_ids: storageIds,
  });
  if (error) redirect(`/profile/checkout?error=${/boat|class and sail/i.test(error.message) ? "boats" : "1"}`);
  revalidatePath("/profile");
  redirect(`/profile/checkout?receipt=${receiptId}`);
}
