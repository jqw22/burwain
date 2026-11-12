import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Notice, SaveButton } from "@/components/fields";
import { meWithRole } from "@/lib/me";
import { addCategory, renameCategory, setCategoryActive } from "./actions";

type Category = {
  id: string;
  name: string;
  direction: "in" | "out";
  is_active: boolean;
};

const SAVED: Record<string, string> = {
  added: "Category added.",
  renamed: "Category renamed. Transactions already in it show the new name.",
  activated: "Category is active again and can be picked for new transactions.",
  deactivated:
    "Category is now inactive. Transactions already in it keep it, but it can't be picked for new ones.",
};
const ERRORS: Record<string, string> = {
  finance: "Only finance logins can change categories.",
  name: "Please give the category a name.",
  direction: "Please choose Money in or Money out.",
  duplicate: "There's already a category with that name.",
  locked:
    "That category is used automatically for member payments, so it can't be changed.",
  save: "We couldn't save that. Please try again.",
};

// Member payments find these by name, so they're locked (the database refuses changes too).
const LOCKED = new Set(["Subscriptions", "Boat storage", "Payment fees"]);

const input = "rounded border border-slate-300 bg-white px-3 py-2";

// Finance manages the categories used on transactions. Categories are never deleted, only made inactive.
export default async function CategoriesPage({
  searchParams,
}: PageProps<"/admin/categories">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("finance");
  if (!allowed) return <NotAllowed who="finance logins" />;

  const [{ data }, { data: used }] = await Promise.all([
    supabase
      .from("transaction_categories")
      .select("id, name, direction, is_active")
      .order("name"),
    supabase
      .from("transactions")
      .select("category_id")
      .not("category_id", "is", null),
  ]);
  const categories = (data ?? []) as Category[];
  const count = new Map<string, number>();
  for (const t of (used ?? []) as { category_id: string }[])
    count.set(t.category_id, (count.get(t.category_id) ?? 0) + 1);
  const saved =
    typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const error =
    typeof params.error === "string" ? ERRORS[params.error] : undefined;

  const list = (dir: "in" | "out", title: string) => {
    const rows = categories
      .filter((c) => c.direction === dir)
      .sort(
        (a, b) =>
          Number(b.is_active) - Number(a.is_active) ||
          a.name.localeCompare(b.name),
      );
    return (
      <Card title={title}>
        {rows.length === 0 ? (
          <p className="text-slate-600">No categories yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4 text-right">Transactions</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">
                  <span className="sr-only">Change</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-t border-slate-100 align-middle"
                >
                  <td className="py-2 pr-4">
                    {LOCKED.has(c.name) ? (
                      <span>
                        {c.name}{" "}
                        <span className="ml-1 text-xs text-slate-500">
                          (used automatically for member payments)
                        </span>
                      </span>
                    ) : (
                      <form
                        action={renameCategory}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <input type="hidden" name="id" value={c.id} />
                        <label className="sr-only" htmlFor={`name-${c.id}`}>
                          Name of {c.name}
                        </label>
                        <input
                          id={`name-${c.id}`}
                          name="name"
                          defaultValue={c.name}
                          required
                          className={`${input} py-1`}
                        />
                        <SaveButton
                          variant="link"
                          aria-label={`Rename ${c.name}`}
                        >
                          Rename
                        </SaveButton>
                      </form>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {count.get(c.id) ?? 0}
                  </td>
                  <td className="py-2 pr-4">
                    {c.is_active ? (
                      "Active"
                    ) : (
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {!LOCKED.has(c.name) && (
                      <form action={setCategoryActive}>
                        <input type="hidden" name="id" value={c.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={c.is_active ? "false" : "true"}
                        />
                        <SaveButton
                          variant="secondary"
                          aria-label={`${c.is_active ? "Make inactive" : "Make active"}: ${c.name}`}
                        >
                          {c.is_active ? "Make inactive" : "Make active"}
                        </SaveButton>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Finance</h1>
      <AdminNav current="categories" />
      <Notice message={saved} />
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
      <p className="text-sm text-slate-600">
        Categories group transactions for the accounts. They can&apos;t be
        deleted, so old transactions keep theirs. Make a category inactive to
        stop it being picked for new transactions.
      </p>

      <Card title="Add a category">
        <form action={addCategory} className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-sm font-medium">Category name</span>
            <input name="name" required className={`mt-1 block ${input}`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">For</span>
            <select
              name="direction"
              defaultValue="out"
              className={`mt-1 block ${input}`}
            >
              <option value="out">Money out</option>
              <option value="in">Money in</option>
            </select>
          </label>
          <SaveButton>Add category</SaveButton>
        </form>
      </Card>

      {list("out", "Money out categories")}
      {list("in", "Money in categories")}
    </div>
  );
}
