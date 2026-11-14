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

export type Boats = { names: string[]; price: number };

export async function valuesFor(
  r: Pick<Recipient, "first_name" | "last_name" | "membership_types" | "renewal_price_pence">,
  yearLabel: string,
  boats: Boats = { names: [], price: 0 },
) {
  const storage = boats.names.length * boats.price;
  return {
    first_name: r.first_name,
    last_name: r.last_name,
    membership_type: r.membership_types,
    renewal_year: yearLabel,
    renewal_price: pounds(r.renewal_price_pence),
    renewal_link: `${await siteOrigin()}/profile#renew`,
    boats: boats.names.length ? boats.names.join(", ") : "none",
    boat_count: String(boats.names.length),
    boat_storage_price: pounds(boats.price),
    boat_storage_total: pounds(storage),
    renewal_total: pounds(r.renewal_price_pence + storage),
  };
}

// The boats each recipient's family stores now (or stored most recently, for lapsed members),
// and today's members rate, for the boat placeholders.
export async function boatsFor(supabase: Awaited<ReturnType<typeof createClient>>, personIds: string[]) {
  const result = new Map<string, Boats>();
  const { data: price } = await supabase.rpc("boat_storage_price", { p_members: true });
  const each = Number(price) || 0;
  if (personIds.length === 0) return { get: (id: string) => result.get(id) ?? { names: [], price: each } };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const { data: people } = await supabase.from("people").select("id, household_id").in("id", personIds);
  const households = ((people ?? []) as { id: string; household_id: string | null }[]).filter((p) => p.household_id);
  const filters = [`person_id.in.(${personIds.join(",")})`];
  if (households.length) filters.push(`household_id.in.(${households.map((p) => p.household_id).join(",")})`);
  const { data } = await supabase
    .from("boat_storages")
    .select("person_id, household_id, boat_class, sail_number, ends_on")
    .neq("status", "cancelled")
    .lte("starts_on", today)
    .or(filters.join(","))
    .order("created_at");
  const rows = (data ?? []) as { person_id: string; household_id: string | null; boat_class: string | null; sail_number: string | null; ends_on: string }[];
  for (const id of personIds) {
    const hh = households.find((p) => p.id === id)?.household_id;
    const mine = rows.filter((b) => b.person_id === id || (hh && b.household_id === hh));
    const latest = mine.map((b) => b.ends_on).sort().at(-1);
    result.set(id, {
      names: mine.filter((b) => b.ends_on === latest).map((b) => `${b.boat_class ?? ""} ${b.sail_number ?? ""}`.trim()),
      price: each,
    });
  }
  return { get: (id: string) => result.get(id) ?? { names: [], price: each } };
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
