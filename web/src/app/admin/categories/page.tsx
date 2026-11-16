import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Notice, SaveButton } from "@/components/fields";
import { FIXED_CATEGORIES as LOCKED, TRANSFER } from "@/lib/budget";
import { meWithRole } from "@/lib/me";
import { addCategory, moveCategory, renameCategory, setCategoryActive } from "./actions";

type Category = {
  id: string;
  name: string;
  direction: "in" | "out";
  is_active: boolean;
  sort_order: number;
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
  locked: "That is a fixed category, so it can't be changed.",
  first: "Subscriptions and Boat storage always come first in Money in.",
  save: "We couldn't save that. Please try again.",
};

const input = "rounded border border-slate-300 bg-white px-3 py-2";

// Finance manages the categories used on transactions. Categories are never deleted, only made inactive.
// Only finance logins can add, rename or make inactive; admins can look.
export default async function CategoriesPage({
  searchParams,
}: PageProps<"/admin/categories">) {
  const params = await searchParams;
  const { supabase, allowed: isAdmin } = await meWithRole("admin");
  const { data: financeRole } = await supabase.rpc("has_role", {
    r: "finance",
  });
  const isFinance = Boolean(financeRole);
  if (!isAdmin && !isFinance)
    return <NotAllowed who="club admins and finance" />;

  const [{ data }, { data: used }] = await Promise.all([
    supabase
      .from("transaction_categories")
      .select("id, name, direction, is_active, sort_order")
      .order("sort_order"),
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
      // In the order they appear on Budget and Actual. Transfer from Saving has its own row there,
      // so it sits at the bottom here without a number.
      .sort(
        (a, b) =>
          Number(a.name === TRANSFER) - Number(b.name === TRANSFER) ||
          a.sort_order - b.sort_order ||
          a.name.localeCompare(b.name),
      );
    const ordered = rows.filter((c) => c.name !== TRANSFER);
    const pinned = (c: Category) => c.name === "Subscriptions" || c.name === "Boat storage";
    const movable = ordered.filter((c) => !pinned(c));
    const moveButton = (c: Category, step: "up" | "down") => {
      const i = movable.indexOf(c);
      const blocked = step === "up" ? i <= 0 : i === movable.length - 1;
      return (
        <form action={moveCategory}>
          <input type="hidden" name="id" value={c.id} />
          <input type="hidden" name="step" value={step} />
          <button
            type="submit"
            disabled={blocked}
            aria-label={`Move ${c.name} ${step}`}
            className="rounded border border-slate-300 bg-white px-1.5 leading-6 text-slate-700 hover:border-sky-800 hover:text-sky-900 disabled:cursor-default disabled:opacity-30"
          >
            {step === "up" ? "↑" : "↓"}
          </button>
        </form>
      );
    };
    return (
      <Card title={title}>
        {rows.length === 0 ? (
          <p className="text-slate-600">No categories yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-600">
              <tr>
                <th className="py-2 pr-2 text-right">No.</th>
                {isFinance && (
                  <th className="py-2 pr-3">
                    <span className="sr-only">Order</span>
                  </th>
                )}
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
                  id={`cat-${c.id}`}
                  className="border-t border-slate-100 align-middle"
                >
                  <td className="py-2 pr-2 text-right tabular-nums text-slate-600">
                    {c.name === TRANSFER ? "" : ordered.indexOf(c) + 1}
                  </td>
                  {isFinance && (
                    <td className="py-2 pr-3">
                      {c.name !== TRANSFER && !pinned(c) && (
                        <div className="flex gap-1">
                          {moveButton(c, "up")}
                          {moveButton(c, "down")}
                        </div>
                      )}
                    </td>
                  )}
                  <td className="py-2 pr-4">
                    {LOCKED.has(c.name) ? (
                      <span>
                        {c.name}{" "}
                        <span className="ml-1 text-xs text-slate-500">
                          {c.name === TRANSFER
                            ? "(fixed: own row on Budget and Actual)"
                            : c.name === "Payment fees"
                              ? "(fixed: card and Direct Debit provider fees)"
                              : "(fixed)"}
                        </span>
                      </span>
                    ) : !isFinance ? (
                      <span>{c.name}</span>
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
                    {isFinance && !LOCKED.has(c.name) && (
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
      <AdminNav current="categories" />
      <Notice message={saved} />
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
      <p className="text-sm text-slate-600">
        Categories group transactions for the accounts. They can&apos;t be
        deleted, so old transactions keep theirs. Make a category inactive to
        stop it being picked for new transactions. The numbers are the order
        categories appear in on the Budget and Actual sheets
        {isFinance && <>: use the arrows to move them</>}. Subscriptions and
        Boat storage are always 1 and 2.
      </p>

      {!isFinance && (
        <p className="text-sm text-slate-600">
          Only finance logins can add, rename or make categories inactive.
        </p>
      )}
      {isFinance && (
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
      )}

      {list("out", "Money out categories")}
      {list("in", "Money in categories")}
    </div>
  );
}
