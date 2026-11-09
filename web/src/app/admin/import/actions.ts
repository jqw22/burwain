"use server";

import { readSheet } from "read-excel-file/universal";
import { requireMe } from "@/lib/me";
import { parseMemberSheet, type ImportRow } from "@/lib/import";

export type ImportState =
  | { step: "upload"; error?: string }
  | { step: "preview"; rows: ImportRow[]; problems: string[]; fileName: string }
  | { step: "done"; summary: { households: number; people: number; skipped: number; memberships: number } };

async function requireAdmin() {
  const me = await requireMe();
  const { data: isAdmin } = await me.supabase.rpc("has_role", { r: "admin" });
  if (!isAdmin) throw new Error("Admins only");
  return me;
}

async function previewImport(_prev: ImportState, form: FormData): Promise<ImportState> {
  const { supabase } = await requireAdmin();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { step: "upload", error: "Please choose the spreadsheet file." };
  if (file.size > 900_000) return { step: "upload", error: "That file is too big for a member list (over 900 KB)." };

  let sheet: unknown[][];
  try {
    sheet = (await readSheet(await file.arrayBuffer())) as unknown[][];
  } catch {
    return { step: "upload", error: "That doesn't look like an Excel (.xlsx) file. In Excel, use File > Save As > Excel Workbook." };
  }
  const { data: types } = await supabase.from("membership_types").select("code");
  const { rows, problems } = parseMemberSheet(sheet, (types ?? []).map((t: { code: string }) => t.code));
  return { step: "preview", rows, problems, fileName: file.name };
}

async function runImport(_prev: ImportState, form: FormData): Promise<ImportState> {
  const { supabase } = await requireAdmin();
  const rows = JSON.parse(String(form.get("rows") ?? "[]")) as ImportRow[];
  const { data, error } = await supabase.rpc("import_members", {
    p_rows: rows,
    p_club_year_id: String(form.get("club_year_id")),
    p_mark_paid: form.get("mark_paid") === "on",
  });
  if (error) return { step: "upload", error: `The import didn't run, and nothing was changed: ${error.message}` };
  return { step: "done", summary: data };
}

export async function importAction(prev: ImportState, form: FormData): Promise<ImportState> {
  if (form.get("intent") === "start-again") return { step: "upload" };
  return form.get("intent") === "import" ? runImport(prev, form) : previewImport(prev, form);
}
