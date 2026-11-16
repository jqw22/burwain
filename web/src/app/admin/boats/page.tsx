import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { adminAccess, ukDate } from "@/lib/me";
import { ukToday } from "@/lib/quote";

type Storage = {
  person_id: string;
  household_id: string | null;
  boat_class: string | null;
  sail_number: string | null;
  status: string;
  ends_on: string | null;
  people: { first_name: string; last_name: string } | null;
};
type Boat = { personId: string; name: string; last: string; first: string; boatClass: string; sail: string; paidTo: string | null };

// Every boat ever booked into storage, one row each (the same boat booked for several periods shows once),
// with the date its storage is paid up to. Dates already past (or boats never paid for) are in red.
export default async function BoatsPage({ searchParams }: PageProps<"/admin/boats">) {
  const params = await searchParams;
  const { supabase, canView } = await adminAccess();
  if (!canView) return <NotAllowed who="club admins and finance" />;
  const sort = params.sort === "type" ? "type" : "name";

  const { data } = await supabase
    .from("boat_storages")
    .select("person_id, household_id, boat_class, sail_number, status, ends_on, people!boat_storages_person_id_fkey(first_name, last_name)")
    .neq("status", "cancelled");

  const boats = new Map<string, Boat>();
  for (const s of (data ?? []) as unknown as Storage[]) {
    const boatClass = (s.boat_class ?? "").trim();
    const sail = (s.sail_number ?? "").trim().toUpperCase();
    const key = [s.household_id ?? s.person_id, boatClass.toLowerCase(), sail].join("|");
    const paid = (s.status === "active" || s.status === "lapsed") && s.ends_on ? s.ends_on : null;
    const b = boats.get(key);
    if (!b) {
      const first = s.people?.first_name ?? "";
      const last = s.people?.last_name ?? "";
      boats.set(key, { personId: s.person_id, name: `${first} ${last}`.trim(), first, last, boatClass, sail, paidTo: paid });
    } else if (paid && (!b.paidTo || paid > b.paidTo)) b.paidTo = paid;
  }

  const byName = (a: Boat, b: Boat) => a.last.localeCompare(b.last) || a.first.localeCompare(b.first);
  const byType = (a: Boat, b: Boat) => a.boatClass.localeCompare(b.boatClass, undefined, { sensitivity: "base" }) || a.sail.localeCompare(b.sail, undefined, { numeric: true });
  const rows = [...boats.values()].sort((a, b) => (sort === "type" ? byType(a, b) || byName(a, b) : byName(a, b) || byType(a, b)));
  const today = ukToday();
  const overdue = rows.filter((b) => !b.paidTo || b.paidTo < today).length;

  const sortHeader = (key: "name" | "type", label: string) => (
    <th className="px-3 py-2 font-medium" aria-sort={sort === key ? "ascending" : undefined}>
      <Link
        href={key === "name" ? "/admin/boats" : "/admin/boats?sort=type"}
        className={sort === key ? "font-semibold text-sky-900 underline" : "underline decoration-dotted hover:text-sky-900"}
      >
        {label}
        {sort === key && <span aria-hidden="true"> ▲</span>}
      </Link>
    </th>
  );

  return (
    <div className="space-y-6">
      <AdminNav current="boats" />
      <p className="text-slate-700">
        {rows.length} {rows.length === 1 ? "boat" : "boats"}, sorted by {sort === "type" ? "boat type" : "member name"}.
        {overdue > 0 && (
          <>
            {" "}
            <strong className="text-red-700">{overdue}</strong> {overdue === 1 ? "is" : "are"} not paid up to date (shown in red).
          </>
        )}
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {sortHeader("name", "Member")}
              {sortHeader("type", "Boat type")}
              <th className="px-3 py-2 font-medium">Sail number</th>
              <th className="px-3 py-2 font-medium">Paid to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((b, i) => {
              const late = !b.paidTo || b.paidTo < today;
              return (
                <tr key={i}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/members/${b.personId}`} className="text-sky-800 underline hover:text-sky-900">
                      {b.name || "(no name)"}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{b.boatClass}</td>
                  <td className="px-3 py-2">{b.sail}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${late ? "font-bold text-red-700" : ""}`}>{b.paidTo ? ukDate(b.paidTo) : "Not paid"}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  No boats yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
