import { AdminNav } from "@/components/admin";
import { Card } from "@/components/fields";
import { requireMe } from "@/lib/me";
import { ImportForm } from "./import-form";

export default async function ImportPage() {
  const { supabase } = await requireMe();
  const { data: isAdmin } = await supabase.rpc("has_role", { r: "admin" });
  if (!isAdmin) {
    return (
      <Card title="Admins only">
        <p className="text-slate-700">This page is for club admins.</p>
      </Card>
    );
  }
  const [{ data: years }, { data: currentYearId }] = await Promise.all([
    supabase.from("club_years").select("id, label").order("starts_on"),
    supabase.rpc("current_club_year_id"),
  ]);

  return (
    <div className="space-y-6">
      <AdminNav current="import" />
      <p className="text-slate-700">
        Upload the member list. You&apos;ll see who will be added, grouped into families, before anything is saved.
        Uploading the same list again is safe: people already here are skipped.
      </p>
      <Card title="Spreadsheet">
        <ImportForm years={years ?? []} currentYearId={(currentYearId as string | null) ?? null} />
      </Card>
    </div>
  );
}
