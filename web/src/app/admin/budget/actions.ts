"use server";

import { redirect } from "next/navigation";
import { parsePounds } from "@/lib/budget";
import { meWithRole } from "@/lib/me";

type Cell = { category_id: string; month: number; amount: string };

export async function saveBudget(form: FormData) {
  const year = Number(form.get("year"));
  const back = (q: string): never => redirect(`/admin/budget?year=${Number.isInteger(year) ? year : ""}&${q}`);
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) back("error=finance");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) back("error=save");

  let cells: Cell[] = [];
  try {
    cells = JSON.parse(String(form.get("cells") ?? "[]"));
  } catch {
    back("error=save");
  }
  const rows = [];
  for (const c of cells) {
    const pence = parsePounds(String(c.amount ?? ""));
    if (pence === null) back("error=amount");
    rows.push({ category_id: c.category_id, month: Number(c.month), amount_pence: pence });
  }
  const { error } = await supabase.rpc("save_budget", { p_year: year, p_cells: rows });
  if (error) back(error.message.includes("Only finance") ? "error=finance" : "error=save");
  back("saved=1");
}
