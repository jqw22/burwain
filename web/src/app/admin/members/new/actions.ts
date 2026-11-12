"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";
import { peopleFromForm } from "@/lib/member-form";

// Database messages an admin can act on. Anything else gets a general message.
const KNOWN: [string, string][] = [
  ["First and last name", "name"],
  ["Date of birth is needed", "dob"],
  ["in the future", "dob_future"],
  ["consent", "consent"],
  ["Dual or Family", "many"],
  ["Up to 4", "four"],
  ["address line 1", "address"],
  ["already uses that email", "email"],
  ["could not be found", "family"],
  ["covers exactly one", "one"],
  ["covers exactly two", "two"],
  ["age limit", "age"],
  ["junior needs an adult", "adult"],
  ["already has", "duplicate"],
  ["not open", "closed"],
  ["not available", "unavailable"],
  ["Only finance", "finance"],
  ["date the payment", "paid_on"],
];

export type AddState = { error?: string; values?: Record<string, string> };

const MESSAGES: Record<string, string> = {
  name: "Please give a first and last name for everyone.",
  dob: "Please give a date of birth for everyone.",
  dob_future: "A date of birth can't be in the future.",
  consent: "Medical information needs the member's consent: tick the box under it.",
  many: "Only Dual and Family memberships cover more than one person.",
  four: "A Family membership covers up to 4 people.",
  address: "A new family needs address line 1 and a postcode.",
  email: "Someone already uses that email. Find them on the Members page instead.",
  family: "Please choose which family they're joining.",
  one: "That membership covers one person.",
  two: "Dual covers two adults. Add both, or add one to a family whose main contact is the other adult.",
  age: "They're over the age limit for that membership, or their date of birth is missing.",
  adult: "A junior needs an adult in the family with a membership for the same year.",
  duplicate: "They already have that kind of membership for the year.",
  closed: "That club year isn't open for membership.",
  unavailable: "That membership type isn't available at the moment.",
  finance: "Only finance can record payments. Leave the payment blank, or ask finance to record it.",
  paid_on: "Give the date the payment was received (not in the future).",
  general: "Something went wrong. Please check the details and try again.",
};

export async function adminAddMember(_prev: AddState, form: FormData): Promise<AddState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return { error: MESSAGES.general, values };
  const family = String(form.get("family") ?? "new");
  const fields = [
    "address_line1", "address_line2", "address_line3", "address_line4", "postcode",
    "type_id", "payment_method", "paid_on",
  ];
  const p: Record<string, unknown> = Object.fromEntries(fields.map((f) => [f, text(form, f)]));
  p.household_id = family === "existing" ? text(form, "household_id") : null;
  if (family === "existing" && !p.household_id) return { error: MESSAGES.family, values };
  if (!p.type_id) p.payment_method = null;

  p.people = peopleFromForm(form);

  const { data, error } = await supabase.rpc("admin_add_member", { p });
  if (error) {
    const key = KNOWN.find(([needle]) => error.message.includes(needle))?.[1] ?? "general";
    const email = error.message.match(/\((.*)\)/)?.[1];
    if (key === "email" && email) return { error: `Someone already uses ${email}. Find them on the Members page instead.`, values };
    return { error: MESSAGES[key], values };
  }
  redirect(`/admin/members/${data}?saved=added`);
}
