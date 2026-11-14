"use server";

import { redirect } from "next/navigation";
import { meWithRole } from "@/lib/me";

// Ticking or unticking "Complete" in a month header on the Actual screen.
export async function setMonthComplete(form: FormData) {
  const year = Number(form.get("year"));
  const month = Number(form.get("month"));
  const back = (q: string): never => redirect(`/admin/actual?year=${Number.isInteger(year) ? year : ""}${q}`);
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) back("&error=finance");
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) back("&error=save");
  const { error } = await supabase.rpc("set_budget_month_complete", {
    p_year: year,
    p_month: month,
    p_complete: form.get("complete") === "1",
  });
  back(error ? "&error=save" : "");
}
