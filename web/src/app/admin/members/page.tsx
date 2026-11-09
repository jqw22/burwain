import Link from "next/link";
import { AdminNav, NotAllowed, STATUS_LABEL } from "@/components/admin";
import { ageOn, meWithRole } from "@/lib/me";

type Row = {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  email: string | null;
  mobile: string | null;
  households: { postcode: string | null } | null;
};
type Held = { person_id: string; memberships: { status: string; membership_types: { code: string } | null } };

export default async function MembersPage({ searchParams }: PageProps<"/admin/members">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  // Letters, digits, spaces, @ . - ' only, so the search can't break the query.
  const q = (typeof params.q === "string" ? params.q : "").replace(/[^\p{L}\p{N} @.\-']/gu, "").trim();
  let query = supabase
    .from("people")
    .select("id, first_name, last_name, date_of_birth, email, mobile, households!people_household_id_fkey(postcode)")
    .is("archived_at", null)
    .order("last_name")
    .order("first_name")
    .limit(500);
  if (q) query = query.or(`first_name.ilike.*${q}*,last_name.ilike.*${q}*,email.ilike.*${q}*`);

  const [{ data: people }, { data: yearId }] = await Promise.all([query, supabase.rpc("current_club_year_id")]);
  const { data: held } = await supabase
    .from("membership_people")
    .select("person_id, memberships!inner(status, club_year_id, membership_types(code))")
    .eq("memberships.club_year_id", yearId as string)
    .neq("memberships.status", "cancelled");
  const byPerson = new Map<string, Held["memberships"][]>();
  for (const h of (held ?? []) as unknown as Held[]) {
    byPerson.set(h.person_id, [...(byPerson.get(h.person_id) ?? []), h.memberships]);
  }
  const rows = (people ?? []) as unknown as Row[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Members</h1>
      <AdminNav current="members" />
      <form className="flex gap-2" role="search">
        <label className="sr-only" htmlFor="q">Search members</label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Search by name or email"
          className="w-full rounded border border-slate-300 bg-white px-3 py-2"
        />
        <button type="submit" className="rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-900">
          Search
        </button>
      </form>
      <p className="text-sm text-slate-600">
        {rows.length} {rows.length === 1 ? "person" : "people"}
        {q && <> matching &ldquo;{q}&rdquo;</>}. Membership shown is for this club year.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Mobile</th>
              <th className="px-3 py-2 font-medium">Postcode</th>
              <th className="px-3 py-2 font-medium">This year</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((p) => {
              const age = ageOn(p.date_of_birth);
              const ms = byPerson.get(p.id) ?? [];
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/members/${p.id}`} className="text-sky-800 underline">
                      {p.last_name}, {p.first_name}
                    </Link>
                    {age !== null && age < 18 && <span className="ml-2 text-xs text-slate-500">junior, {age}</span>}
                  </td>
                  <td className="px-3 py-2">{p.email}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.mobile}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{p.households?.postcode}</td>
                  <td className="px-3 py-2">
                    {ms.length === 0 ? (
                      <span className="text-slate-400">None</span>
                    ) : (
                      ms.map((m, i) => (
                        <span key={i} className="mr-2 whitespace-nowrap">
                          {m.membership_types?.code}: {STATUS_LABEL[m.status] ?? m.status}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
