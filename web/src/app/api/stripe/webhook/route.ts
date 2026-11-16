import { createAdminClient } from "@/lib/supabase/admin";
import { recordCheckout, verifyWebhook } from "@/lib/stripe";

// Stripe calls this when a card payment goes through (or a payment page expires without payment).
// Address to give Stripe: https://<site>/api/stripe/webhook
// Events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.expired
export async function POST(request: Request) {
  const payload = await request.text();
  const event = verifyWebhook(payload, request.headers.get("stripe-signature"));
  if (!event) return new Response("Bad signature", { status: 400 });

  const session = event.data.object;
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await recordCheckout(session);
    } else if (event.type === "checkout.session.expired" && session.metadata?.kind === "receipt" && session.metadata.id) {
      const { error } = await createAdminClient().rpc("fail_card_receipt", { p_receipt: session.metadata.id });
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    console.error("Stripe webhook", event.type, session.id, e);
    return new Response("Couldn't record it, please retry", { status: 500 });   // Stripe tries again later
  }
  return Response.json({ received: true });
}
