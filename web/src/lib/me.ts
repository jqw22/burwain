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

// The signed-in member plus whether they hold a role (superadmins pass every check).
export async function meWithRole(role: "admin" | "finance" | "superadmin") {
  const me = await requireMe();
  const { data } = await me.supabase.rpc("has_role", { r: role });
  return { ...me, allowed: Boolean(data) };
}

// What the signed-in person may do in the admin areas. Admins manage Membership and Communications;
// finance logins can look at those areas but not change them. Finance manages the Finance area and
// admins can only look at it. Superadmins pass every check and also manage roles and club titles.
export async function adminAccess() {
  const me = await requireMe();
  const [{ data: a }, { data: f }, { data: s }] = await Promise.all([
    me.supabase.rpc("has_role", { r: "admin" }),
    me.supabase.rpc("has_role", { r: "finance" }),
    me.supabase.rpc("has_role", { r: "superadmin" }),
  ]);
  const isAdmin = Boolean(a);
  const isFinance = Boolean(f);
  return { ...me, isAdmin, isFinance, isSuper: Boolean(s), canView: isAdmin || isFinance };
}

export function ageOn(dob: string | null, on = new Date()) {
  if (!dob) return null;
  const d = new Date(dob);
  let age = on.getFullYear() - d.getFullYear();
  if (on < new Date(on.getFullYear(), d.getMonth(), d.getDate())) age -= 1;
  return age;
}

export function ukDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function pounds(pence: number) {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}
