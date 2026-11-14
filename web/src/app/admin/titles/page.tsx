import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Notice, SaveButton } from "@/components/fields";
import { adminAccess } from "@/lib/me";
import { saveTitle, setTitleActive } from "./actions";

type Title = { id: string; name: string; sort_order: number; is_active: boolean };
type Holder = { title_id: string; person_id: string; people: { first_name: string; last_name: string } | null };

const SAVED: Record<string, string> = { added: "Title added.", saved: "Title saved." };
const ERRORS: Record<string, string> = {
  duplicate: "There is already a title with that name.",
  save: "We couldn't save that. Give the title a name and a whole number for its order.",
};

const input = "rounded border border-slate-300 bg-white px-3 py-1";

// The club's titles (for example Commodore or Treasurer). Superadmins keep the list and give titles to
// members on each member's page; titles are shown at the top of the Directory in this order.
export default async function TitlesPage({ searchParams }: PageProps<"/admin/titles">) {
  const params = await searchParams;
  const { supabase, canView, isSuper } = await adminAccess();
  if (!canView) return <NotAllowed who="club admins and finance" />;

  const [{ data: titleData }, { data: holderData }] = await Promise.all([
    supabase.from("club_titles").select("id, name, sort_order, is_active").order("sort_order").order("name"),
    supabase.from("person_titles").select("title_id, person_id, people!person_titles_person_id_fkey(first_name, last_name)"),
  ]);
  const titles = (titleData ?? []) as Title[];
  const holders = (holderData ?? []) as unknown as Holder[];
  const nextOrder = Math.max(0, ...titles.map((t) => t.sort_order)) + 10;
  const saved = typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <div className="space-y-6">
      <AdminNav current="titles" />
      <Notice message={saved} />
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}
      <p className="text-slate-700">
        Club titles are shown at the top of the Directory, in the order below (lowest number first). Anyone can hold a title, with
        or without admin access. {isSuper ? "Give a member a title on their member page, under Access and club titles." : "Superadmins give titles to members and keep this list."}{" "}
        Titles are never deleted; make one inactive to take it out of the Directory.
      </p>

      {isSuper && (
        <Card title="Add a title">
          <form action={saveTitle} className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-sm font-medium">Title</span>
              <input name="name" required maxLength={60} className={`mt-1 block ${input} py-2`} />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Order</span>
              <input name="sort_order" type="number" step={1} required defaultValue={nextOrder} className={`mt-1 block w-24 ${input} py-2`} />
            </label>
            <SaveButton>Add title</SaveButton>
          </form>
        </Card>
      )}

      <Card title="Club titles">
        {titles.length === 0 ? (
          <p className="text-slate-600">No titles yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="py-2 pr-4">Title and order</th>
                  <th className="py-2 pr-4">Held by</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2">
                    <span className="sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {titles.map((t) => {
                  const people = holders.filter((h) => h.title_id === t.id && h.people);
                  return (
                    <tr key={t.id} aria-label={t.name} className="align-middle">
                      <td className="py-2 pr-4">
                        {isSuper ? (
                          <form action={saveTitle} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="id" value={t.id} />
                            <label className="sr-only" htmlFor={`name-${t.id}`}>
                              Name of {t.name}
                            </label>
                            <input id={`name-${t.id}`} name="name" defaultValue={t.name} required maxLength={60} className={input} />
                            <label className="sr-only" htmlFor={`order-${t.id}`}>
                              Order of {t.name}
                            </label>
                            <input id={`order-${t.id}`} name="sort_order" type="number" step={1} defaultValue={t.sort_order} required className={`w-20 ${input}`} />
                            <SaveButton variant="link" aria-label={`Save ${t.name}`}>
                              Save
                            </SaveButton>
                          </form>
                        ) : (
                          <>
                            <strong>{t.name}</strong> <span className="text-slate-500">({t.sort_order})</span>
                          </>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {people.length === 0
                          ? <span className="text-slate-500">No one</span>
                          : people.map((h, i) => (
                              <span key={h.person_id}>
                                {i > 0 && ", "}
                                <Link href={`/admin/members/${h.person_id}`} className="text-sky-800 underline">
                                  {h.people!.first_name} {h.people!.last_name}
                                </Link>
                              </span>
                            ))}
                      </td>
                      <td className="py-2 pr-4">
                        {t.is_active ? "Active" : <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">Inactive</span>}
                      </td>
                      <td className="py-2 text-right">
                        {isSuper && (
                          <form action={setTitleActive}>
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="active" value={t.is_active ? "false" : "true"} />
                            <SaveButton variant="secondary" aria-label={`${t.is_active ? "Make inactive" : "Make active"}: ${t.name}`}>
                              {t.is_active ? "Make inactive" : "Make active"}
                            </SaveButton>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
