import type { Metadata } from "next";
import Link from "next/link";
import { Card, SaveButton } from "@/components/fields";
import { pounds } from "@/lib/me";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardPaymentsOn } from "@/lib/stripe";
import { payApplication } from "../actions";

export const metadata: Metadata = { title: "Join Burwain: payment" };

// Where Stripe sends people who leave its payment page without paying: the application is saved,
// so they can try again (for a day after applying). No login needed.
export default async function JoinPayPage({ searchParams }: PageProps<"/join/pay">) {
  const params = await searchParams;
  const id = typeof params.application === "string" && /^[0-9a-f-]{36}$/i.test(params.application) ? params.application : null;
  const app =
    id && cardPaymentsOn()
      ? (
          await createAdminClient()
            .rpc("application_to_pay", { p_id: id })
            .maybeSingle<{ amount_pence: number; contact_name: string; type_name: string }>()
        ).data
      : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Join Burwain</h1>
      {params.error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          Sorry, we couldn&apos;t open the card payment page. Please try again, or contact the membership secretary.
        </p>
      )}
      {app ? (
        <Card title="Payment not finished">
          <form action={payApplication} className="space-y-4">
            <p className="text-slate-700">
              Your application for <strong>{app.type_name}</strong> is saved, but it hasn&apos;t been paid for yet, so nothing
              has been taken. Membership is paid when you apply.
            </p>
            <input type="hidden" name="application_id" value={id ?? ""} />
            <SaveButton pendingText="Going to payment…">Pay {pounds(app.amount_pence)} by card</SaveButton>
          </form>
        </Card>
      ) : (
        <Card title="Nothing to pay">
          <p className="text-slate-700">
            This application has already been paid for, or the link has expired. If you&apos;re not sure, please contact the
            membership secretary.
          </p>
          <Link href="/join" className="mt-3 inline-block text-sky-800 underline">
            Back to Join
          </Link>
        </Card>
      )}
    </div>
  );
}
