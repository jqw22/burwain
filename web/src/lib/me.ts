import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Person = {
  id: string;
  household_id: string | null;
  title: string | null;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  email: string | null;
  mobile: string | null;
  whatsapp: boolean;
  emergency_contact_name: string | null;
  emergency_contact_mobile: string | null;
  first_joined_on: string | null;
  directory_opt_out: boolean;
  news_consent: boolean;
};

export const PERSON_FIELDS =
  "id, household_id, title, first_name, last_name, date_of_birth, email, mobile, whatsapp, emergency_contact_name, emergency_contact_mobile, first_joined_on, directory_opt_out, news_consent";

// The signed-in member's id, or a redirect home (which explains an unmatched login).
export async function requireMe() {
  const supabase = await createClient();
  const { data: personId } = await supabase.rpc("link_my_account");
  if (!personId) redirect("/");
  return { supabase, personId: personId as string };
}

// Empty form fields become null.
export function text(form: FormData, name: string): string | null {
  const v = String(form.get(name) ?? "").trim();
  return v === "" ? null : v;
}
