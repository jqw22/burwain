"use server";

import { redirect } from "next/navigation";
import { meWithRole, text } from "@/lib/me";

function back(key: string, values: Record<string, string> = {}): never {
  redirect(`/admin/transactions/new?error=${key}&${new URLSearchParams(values)}`);
}

// Finance adds a transaction by hand, for example a payment to a supplier or a donation.
export async function addTransaction(form: FormData) {
  const { supabase, personId, allowed } = await meWithRole("finance");
  if (!allowed) back("finance");

  const direction = form.get("direction") === "in" ? "in" : form.get("direction") === "out" ? "out" : null;
  const occurredOn = text(form, "occurred_on");
  const description = text(form, "description");
  const party = text(form, "party");
  const categoryId = text(form, "category_id");
  const method = text(form, "method");
  const amount = Number(String(form.get("amount") ?? "").replace(/[£,\s]/g, ""));
  const pence = Math.round(amount * 100);
  const keep = Object.fromEntries(
    Object.entries({ direction, occurred_on: occurredOn, description, party, category_id: categoryId, method, amount: String(form.get("amount") ?? "") })
      .filter(([, v]) => v) as [string, string][],
  );

  if (!direction) back("direction", keep);
  if (!occurredOn || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) back("date", keep);
  if (!description) back("description", keep);
  if (!Number.isFinite(amount) || pence <= 0) back("amount", keep);
  if (!categoryId) back("nocategory", keep);
  {
    const { data: cat } = await supabase.from("transaction_categories").select("direction, is_active").eq("id", categoryId).single();
    if (cat?.direction !== direction) back("category", keep);
    if (!cat.is_active) back("inactive", keep);
  }

  const { error } = await supabase.from("transactions").insert({
    occurred_on: occurredOn,
    description,
    party,
    direction,
    amount_pence: pence,
    category_id: categoryId,
    method,
    recorded_by: personId,
  });
  if (error) back("save", keep);

  // Show the month the transaction falls in, so it's on the list straight away.
  const [y, m] = occurredOn.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  redirect(`/admin/transactions?saved=added&from=${y}-${mm}-01&to=${y}-${mm}-${String(last).padStart(2, "0")}`);
}
