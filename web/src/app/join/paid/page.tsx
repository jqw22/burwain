import type { Metadata } from "next";
import { Card } from "@/components/fields";
import { pounds } from "@/lib/me";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardPaymentsOn, getCheckout, recordCheckout } from "@/lib/stripe";

export const metadata: Metadata = { title: "Join Burwain: thank you" };

// Where Stripe sends people after paying on the Join form. The payment is recorded now (as well as
// by Stripe's webhook) and held on the application until an admin accepts it. No login needed.
export default async function JoinPaidPage({ searchParams }: PageProps<"/join/paid">) {
  const params = await searchParams;
  let app: { contact_name: string; contact_email: string; type_name: string; paid_pence: number | null; boats_pence: number } | null = null;
  if (cardPaymentsOn() && typeof params.session_id === "string") {
    try {
      const done = await recordCheckout(await getCheckout(params.session_id));
      if (done?.kind === "application") {
        const { data } = await createAdminClient()
          .from("membership_applications")
          .select("contact_name, contact_email, type_name, paid_pence, boats_pence")
          .eq("id", done.id)
          .maybeSingle();
        app = data;
      }
    } catch (e) {
      console.error("Stripe return (join)", e);
    }
  }
  const first = app?.contact_name.split(" ")[0];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Join Burwain</h1>
      <Card title="Thank you">
        <div className="space-y-3 text-slate-800" role="status">
          {app ? (
            <>
              <p>
                Thanks{first ? `, ${first}` : ""}. We&apos;ve received your application for <strong>{app.type_name}</strong>.
              </p>
              <p>
                The membership secretary will check it and email {app.contact_email}. Once you&apos;re accepted you can log in
                with that email.
              </p>
            </>
          ) : (
            <p>
              Thank you. We&apos;re waiting for confirmation of your card payment, which usually takes a few moments. The
              membership secretary will be in touch about your application.
            </p>
          )}
        </div>
      </Card>
      {app && (
        <Card title="Payment confirmed">
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-3 font-medium text-emerald-900">
              <span aria-hidden="true">✓</span>
              Your payment of {pounds((app.paid_pence ?? 0) + app.boats_pence)} by card is confirmed.
            </p>
            <p className="text-sm text-slate-700">
              Your membership will show as paid once the membership secretary accepts your application. If it isn&apos;t
              accepted, your payment will be refunded.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
