"use server";

import { createClient } from "@/lib/supabase/server";
import { text } from "@/lib/me";
import { peopleFromForm } from "@/lib/member-form";

export type JoinState = {
  error?: string;
  values?: Record<string, string>;
  done?: { name: string; email: string; type: string; year: string; price: string; applicationId?: string };
};

export type PayState = { error?: string; paid?: { pence: number; method: "card" | "direct_debit" } };

const KNOWN: [string, string][] = [
  ["First and last name", "Please give a first and last name for everyone."],
  ["Date of birth is needed", "Please give a date of birth for everyone."],
  ["in the future", "A date of birth can't be in the future."],
  ["email address is needed", "Please give an email address for the first person. We'll use it to get in touch."],
  ["already uses that email", "That email already belongs to a member. Please log in instead, or contact the membership secretary."],
  ["already an application", "We already have an application waiting for that email. We'll be in touch soon."],
  ["consent", "Medical information needs your agreement: please tick the box under it."],
  ["address line 1", "Please give your address and postcode."],
  ["covers exactly one", "That membership covers one person."],
  ["covers exactly two", "Dual membership covers two adults. Please fill in both."],
  ["age limit", "Someone is over the age limit for that membership, or their date of birth is missing."],
  ["Up to 4", "A Family membership covers up to 4 people."],
  ["not available", "That membership type isn't available at the moment."],
  ["Too many", "We're getting a lot of applications right now. Please try again in an hour."],
];

// No login needed: anyone can apply. Applications wait for a club admin to accept them.
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
  };
  // Bots fill in every box, including this hidden one. Pretend it worked and store nothing.
  if (text(form, "website")) return { done };

  const p = {
    type_id: text(form, "type_id"),
    address_line1: text(form, "address_line1"),
    address_line2: text(form, "address_line2"),
    address_line3: text(form, "address_line3"),
    address_line4: text(form, "address_line4"),
    postcode: text(form, "postcode"),
    people,
  };
  const supabase = await createClient();
  const { data: applicationId, error } = await supabase.rpc("submit_application", { p });
  if (error) {
    const message = KNOWN.find(([needle]) => error.message.includes(needle))?.[1];
    return { error: message ?? "Something went wrong. Please check your details and try again.", values };
  }
  return { done: { ...done, applicationId: String(applicationId) } };
}

// Test checkout straight after applying: no money is taken, but the payment is held on the
// application. When an admin accepts it, the membership is created already paid and the income recorded.
export async function payApplication(_prev: PayState, form: FormData): Promise<PayState> {
  const method = form.get("method") === "direct_debit" ? "direct_debit" : "card";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pay_application_test", { p_id: text(form, "application_id"), p_method: method });
  if (error) return { error: "Sorry, the payment didn't go through. The membership secretary will email you about paying." };
  return { paid: { pence: Number(data) || 0, method } };
}
