import { AdminNav, NotAllowed } from "@/components/admin";
import { meWithRole } from "@/lib/me";
import { ukToday } from "@/lib/quote";
import { AddMemberForm, type Family, type Type } from "./add-form";

type Household = { id: string; postcode: string | null; address_line1: string | null; lead_person_id: string | null };
type Person = { id: string; first_name: string; last_name: string; household_id: string | null };

// Club admins add new members here. Members renew from Your details; joining is done by admins for now.
export default async function AddMemberPage({ searchParams }: PageProps<"/admin/members/new">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const today = ukToday();
  const [{ data: types }, { data: households }, { data: people }, { data: isFinance }] = await Promise.all([
    supabase
      .from("membership_types")
      .select("id, starts_on, ends_on, name, cover, annual_price_pence, sibling_order")
      .eq("is_open", true)
      .gte("ends_on", today)
      .order("starts_on")
      .order("sort_order"),
    supabase.from("households").select("id, postcode, address_line1, lead_person_id"),
    supabase.from("people").select("id, first_name, last_name, household_id").is("archived_at", null).not("household_id", "is", null),
    supabase.rpc("has_role", { r: "finance" }),
  ]);
  // Families holding a Family or Dual membership that hasn't ended: the only ones new members can join.
  const { data: shared } = await supabase
    .from("memberships")
    .select("household_id, membership_types!inner(cover, ends_on)")
    .neq("status", "cancelled")
    .in("membership_types.cover", ["family", "dual"])
    .gte("membership_types.ends_on", today);
  const sharing = new Set(((shared ?? []) as { household_id: string | null }[]).map((m) => m.household_id));
  const everyone = (people ?? []) as Person[];
  const families: Family[] = ((households ?? []) as Household[])
    .map((h) => {
      const members = everyone.filter((p) => p.household_id === h.id);
      const lead = members.find((p) => p.id === h.lead_person_id) ?? members[0];
      return {
        id: h.id,
        shared: sharing.has(h.id),
        label: lead
          ? `${lead.last_name}, ${lead.first_name}${members.length > 1 ? ` and ${members.length - 1} more` : ""}${h.postcode ? ` (${h.postcode})` : ""}`
          : `No one yet${h.postcode ? ` (${h.postcode})` : ""}`,
        sort: lead ? `${lead.last_name} ${lead.first_name}` : "~",
      };
    })
    .sort((a, b) => a.sort.localeCompare(b.sort));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Add new member</h1>
      <AdminNav current="members" />
      <p className="text-slate-700">
        Add someone joining the club. Existing members renew themselves from Your details. If you give an email, they
        can log in with it straight away.
      </p>
      <AddMemberForm
        types={(types ?? []) as Type[]}
        families={families}
        canRecordPayment={Boolean(isFinance)}
        householdId={typeof params.household === "string" ? params.household : undefined}
        today={today}
      />
    </div>
  );
}
