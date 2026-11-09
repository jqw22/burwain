"use server";

import { redirect } from "next/navigation";
import { requireMe } from "@/lib/me";

// Database messages we can explain to members. Anything else gets a general message.
const KNOWN: [string, string][] = [
  ["Choose who", "who"],
  ["own household", "household"],
  ["covers exactly one", "one"],
  ["covers exactly two", "two"],
  ["age limit", "age"],
  ["junior needs an adult", "adult"],
  ["already has", "duplicate"],
  ["not open", "closed"],
  ["not available", "unavailable"],
];

export async function chooseMembership(form: FormData) {
  const { supabase } = await requireMe();
  const typeId = String(form.get("type_id") ?? "");
  const yearId = String(form.get("club_year_id") ?? "");
  const people = form.getAll("person_id").map(String);
  if (!typeId) redirect("/membership?error=type");
  if (people.length === 0) redirect("/membership?error=who");

  const { error } = await supabase.rpc("start_membership", {
    p_type_id: typeId,
    p_person_ids: people,
    p_club_year_id: yearId,
  });
  if (error) {
    const key = KNOWN.find(([needle]) => error.message.includes(needle))?.[1] ?? "general";
    redirect(`/membership?error=${key}`);
  }
  redirect("/membership?saved=added");
}

export async function cancelMembership(form: FormData) {
  const { supabase } = await requireMe();
  const { error } = await supabase.rpc("cancel_my_membership", { p_membership: String(form.get("id")) });
  redirect(error ? "/membership?error=cancel" : "/membership?saved=cancelled");
}
