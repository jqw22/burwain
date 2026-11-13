import "server-only";

import { headers } from "next/headers";
import { pounds } from "@/lib/me";
import type { createClient } from "@/lib/supabase/server";

export type Recipient = {
  person_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  membership_types: string;
  renewal_price_pence: number;
  last_reminded_at: string | null;
};
export type Template = { id: string; subject: string; body: string };

export async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "burwain.netlify.app";
  return `${host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https"}://${host}`;
}

export async function valuesFor(r: Pick<Recipient, "first_name" | "last_name" | "membership_types" | "renewal_price_pence">, yearLabel: string) {
  return {
    first_name: r.first_name,
    last_name: r.last_name,
    membership_type: r.membership_types,
    renewal_year: yearLabel,
    renewal_price: pounds(r.renewal_price_pence),
    renewal_link: `${await siteOrigin()}/profile#renew`,
  };
}


// The year members are renewing for: the year the next membership types start in. Null until any active
// type starts after today (reminders wait until there's something to renew onto).
export async function renewalYear(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ label: string } | null> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const { data } = await supabase
    .from("membership_types")
    .select("starts_on")
    .eq("is_open", true)
    .gt("starts_on", today)
    .order("starts_on")
    .limit(1)
    .maybeSingle();
  return data ? { label: String((data as { starts_on: string }).starts_on).slice(0, 4) } : null;
}
