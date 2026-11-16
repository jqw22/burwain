"use server";

import { createClient } from "@/lib/supabase/server";
import { text, WHATSAPP_NEEDS_MOBILE } from "@/lib/me";
import { peopleFromForm } from "@/lib/member-form";
import { boatsFromForm } from "@/lib/boats";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardPaymentsOn, createCheckout, siteOrigin } from "@/lib/stripe";

export type JoinState = {
  error?: string;
  values?: Record<string, string>;
  done?: { name: string; email: string; type: string; year: string; price: string; method: "card" | "direct_debit" };
};

const KNOWN: [string, string][] = [
  ["First and last name", "Please give a first and last name for everyone."],
  ["Date of birth is needed", "Please give a date of birth for everyone."],
  ["in the future", "A date of birth can't be in the future."],
  ["email address is needed", "Please give an email address for the first person. We'll use it to get in touch."],
  // Same message for a member's email and an application already waiting, so nobody can use the form to find out who is a member.
  ["take a new application with that email", "We can't take a new application with that email address. If you've applied before or are already a member, please log in or contact the membership secretary."],
  ["consent", "Medical information needs your agreement: please tick the box under it."],
  ["address line 1", "Please give your address and postcode."],
  ["covers exactly one", "That membership covers one person."],
  ["covers exactly two", "Dual membership covers two adults. Please fill in both."],
  ["age limit", "Someone is over the age limit for that membership, or their date of birth is missing."],
  ["Up to 4", "A Family membership covers up to 4 people."],
  ["not available", "That membership type isn't available at the moment."],
  ["Up to 3 boats", "Up to 3 boats can be stored per membership."],
  ["class and sail number", "Please give a class and sail number for each boat."],
  ["Too many", "We're getting a lot of applications right now. Please try again in an hour."],
];

// No login needed: anyone can apply, paying as they do. Applications wait for a club admin to accept them.
export async function submitApplication(_prev: JoinState, form: FormData): Promise<JoinState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const people = peopleFromForm(form);
  const first = people[0] as { first_name: string | null; email: string | null };
  const done = {
    name: first.first_name ?? "",
    email: first.email ?? "",
    type: String(form.get("type_label") ?? ""),
    year: String(form.get("year_label") ?? ""),
    price: String(form.get("price_label") ?? ""),
    method: (form.get("method") === "direct_debit" ? "direct_debit" : "card") as "card" | "direct_debit",
  };
  // Bots fill in every box, including this hidden one. Pretend it worked and store nothing.
  if (text(form, "website")) return { done };
  if ((people as { whatsapp: boolean; mobile: unknown }[]).some((x) => x.whatsapp && !x.mobile)) return { error: WHATSAPP_NEEDS_MOBILE, values };

  const p = {
    type_id: text(form, "type_id"),
    address_line1: text(form, "address_line1"),
    address_line2: text(form, "address_line2"),
    address_line3: text(form, "address_line3"),
    address_line4: text(form, "address_line4"),
    postcode: text(form, "postcode"),
    people,
    boats: boatsFromForm(form),
  };
  const supabase = await createClient();
  const { data: applicationId, error } = await supabase.rpc("submit_application", { p });
  if (error) {
    const message = KNOWN.find(([needle]) => error.message.includes(needle))?.[1];
    return { error: message ?? "Something went wrong. Please check your details and try again.", values };
  }
  // Card payment with Stripe: the application is saved, then they pay on Stripe's secure page.
  if (cardPaymentsOn()) {
    const url = await applicationCheckoutUrl(applicationId as string);
    if (!url) redirect(`/join/pay?application=${applicationId}&error=1`);
    redirect(url);
  }
  // Test checkout: no money is taken. The payment is held on the application; when an admin
  // accepts it, the membership is created already paid and the income recorded.
  const { error: payError } = await supabase.rpc("pay_application_test", { p_id: applicationId, p_method: done.method });
  if (payError) return { error: "Your application was sent, but the payment didn't go through. The membership secretary will be in touch." };
  return { done };
}


// A Stripe payment page for an application that hasn't been paid for yet (null if it can't be paid).
async function applicationCheckoutUrl(applicationId: string): Promise<string | null> {
  const { data: app } = await createAdminClient()
    .rpc("application_to_pay", { p_id: applicationId })
    .maybeSingle<{ amount_pence: number; contact_email: string; type_name: string }>();
  if (!app) return null;
  const origin = await siteOrigin();
  try {
    const session = await createCheckout({
      for: { kind: "application", id: applicationId },
      amountPence: app.amount_pence,
      description: `Burwain membership: ${app.type_name}`,
      email: app.contact_email,
      successUrl: `${origin}/join/paid?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/join/pay?application=${applicationId}`,
    });
    return session.url;
  } catch (e) {
    console.error("Stripe checkout (join)", e);
    return null;
  }
}

// "Try again" after leaving Stripe's page without paying.
export async function payApplication(form: FormData) {
  const id = String(form.get("application_id") ?? "");
  if (!cardPaymentsOn() || !/^[0-9a-f-]{36}$/i.test(id)) redirect("/join");
  const url = await applicationCheckoutUrl(id);
  redirect(url ?? `/join/pay?application=${id}&error=1`);
}
