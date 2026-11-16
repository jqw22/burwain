"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { boatsFromForm } from "@/lib/boats";
import { requireMe } from "@/lib/me";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCheckout, siteOrigin } from "@/lib/stripe";

function errorCode(message: string) {
  return /boat|class and sail/i.test(message) ? "boats" : "1";
}

// Card payment with Stripe: what's being paid for is saved as a pending receipt (with any boats
// added), then the member goes to Stripe's secure page. It's marked paid when Stripe confirms.
export async function payCard(form: FormData) {
  const { supabase } = await requireMe();
  const { data, error } = await supabase
    .rpc("start_my_card_payment", {
      p_membership_ids: form.getAll("membership_id").map(String).filter(Boolean),
      p_boats: boatsFromForm(form),
      p_storage_ids: form.getAll("storage_id").map(String).filter(Boolean),
    })
    .single<{ receipt_id: string; amount_pence: number; payer_email: string | null }>();
  if (error || !data) redirect(`/profile/checkout?error=${errorCode(error?.message ?? "")}`);
  revalidatePath("/profile");

  const origin = await siteOrigin();
  let url: string | null = null;
  try {
    const session = await createCheckout({
      for: { kind: "receipt", id: data.receipt_id },
      amountPence: data.amount_pence,
      description: "Burwain membership",
      email: data.payer_email,
      successUrl: `${origin}/profile/checkout?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/profile/checkout?cancelled=1`,
    });
    url = session.url;
  } catch (e) {
    console.error("Stripe checkout", e);
  }
  if (!url) {
    await createAdminClient().rpc("fail_card_receipt", { p_receipt: data.receipt_id });
    redirect("/profile/checkout?error=1");
  }
  redirect(url);
}

// Test checkout: no payment provider is called and no money is taken, but the payment is
// recorded and the memberships and boat storage are marked as paid. Used until the Stripe keys are set.
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
  if (error) redirect(`/profile/checkout?error=${errorCode(error.message)}`);
  revalidatePath("/profile");
  redirect(`/profile/checkout?receipt=${receiptId}`);
}
