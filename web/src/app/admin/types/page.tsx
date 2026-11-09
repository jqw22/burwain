import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Checkbox, Field, Notice, SaveButton } from "@/components/fields";
import { meWithRole, pounds } from "@/lib/me";
import { saveType, setActive } from "./actions";

type MembershipType = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: "sailing" | "non_sailing";
  cover: "individual" | "dual" | "family" | "junior";
  annual_price_pence: number;
  max_age: number | null;
  requires_adult_member: boolean;
  requires_approval: boolean;
  sibling_order: number | null;
  is_open: boolean;
  sort_order: number;
};

const CATEGORY = { sailing: "Sailing", non_sailing: "Non-sailing" } as const;
const COVER = {
  individual: "One person",
  dual: "Two adults (Dual)",
  family: "Family (up to 4)",
  junior: "Junior",
} as const;

const SAVED: Record<string, string> = {
  added: "Membership type added.",
  updated: "Membership type saved.",
  activated: "Membership type is active again. It's offered to new members and for renewal.",
  deactivated: "Membership type is now inactive. Existing memberships aren't affected.",
};
const ERRORS: Record<string, string> = {
  admin: "Only club admins can change membership types.",
  name: "Please give the membership type a name.",
  code: "The short code must be 1 to 10 capital letters or numbers, with no spaces (for example SUP or J1).",
  price: "Please enter the price in pounds, for example 95 or 95.50.",
  age: "The age limit must be a whole number of years, or left blank.",
  sibling: "The junior sibling number must be 1 to 9, or left blank.",
  order: "The list position must be a whole number.",
  duplicate: "Another membership type already uses that short code. Please choose a different one.",
  save: "We couldn't save that. Please try again.",
};

const select = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";

function TypeForm({ type, nextOrder }: { type: MembershipType | null; nextOrder: number }) {
  return (
    <Card title={type ? `Edit ${type.name}` : "Add a membership type"} id="edit">
      <form action={saveType} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={type?.id ?? ""} />
        <Field label="Name" name="name" defaultValue={type?.name} required />
        <Field
          label="Short code"
          name="code"
          defaultValue={type?.code}
          required
          hint="Used on reports and the spreadsheet import, for example SUP."
        />
        <div className="sm:col-span-2">
          <label className="block">
            <span className="text-sm font-medium">Description</span>
            <textarea
              name="description"
              rows={2}
              defaultValue={type?.description ?? ""}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"
            />
            <span className="mt-1 block text-xs text-slate-500">Shown to people choosing a membership.</span>
          </label>
        </div>
        <Field
          label="Price for a full year (£)"
          name="price"
          defaultValue={type ? (type.annual_price_pence / 100).toFixed(2) : ""}
          required
          hint="Changing the price only affects new memberships and renewals, not ones already taken."
        />
        <label className="block">
          <span className="text-sm font-medium">Category</span>
          <select name="category" defaultValue={type?.category ?? "sailing"} className={select}>
            {Object.entries(CATEGORY).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium">Who it covers</span>
          <select name="cover" defaultValue={type?.cover ?? "individual"} className={select}>
            {Object.entries(COVER).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <Field
          label="Age limit (oldest age allowed)"
          name="max_age"
          type="number"
          defaultValue={type?.max_age?.toString()}
          hint="For example 17 for juniors. Leave blank for no limit. Checked on 1 January of the membership year."
        />
        <Field
          label="Junior sibling number"
          name="sibling_order"
          type="number"
          defaultValue={type?.sibling_order?.toString()}
          hint="Only for junior prices: 1 for the first child, 2 for the second, 3 for the third and more. Otherwise leave blank."
        />
        <Field
          label="Position in lists"
          name="sort_order"
          type="number"
          defaultValue={(type?.sort_order ?? nextOrder).toString()}
          hint="Lower numbers are shown first."
        />
        <div className="space-y-2 sm:col-span-2">
          <Checkbox label="Needs admin approval before it can be paid (like Associate)" name="requires_approval" defaultChecked={type?.requires_approval} />
          <Checkbox label="Needs an adult member in the same family (like Junior)" name="requires_adult_member" defaultChecked={type?.requires_adult_member} />
          <Checkbox label="Active: offered to new members, on the Join page and for renewal" name="is_open" defaultChecked={type?.is_open ?? true} />
        </div>
        <div className="flex items-center gap-4 sm:col-span-2">
          <SaveButton>{type ? "Save changes" : "Add membership type"}</SaveButton>
          <Link href="/admin/types" className="text-sm text-slate-600 underline">Cancel</Link>
        </div>
      </form>
    </Card>
  );
}

export default async function TypesPage({ searchParams }: PageProps<"/admin/types">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const { data } = await supabase.from("membership_types").select("*").order("sort_order").order("name");
  const types = (data ?? []) as MembershipType[];
  const active = types.filter((t) => t.is_open);
  const inactive = types.filter((t) => !t.is_open);
  const edit = typeof params.edit === "string" ? params.edit : "";
  const editing = types.find((t) => t.id === edit) ?? null;
  const nextOrder = Math.max(0, ...types.map((t) => t.sort_order)) + 10;

  const saved = typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  const table = (list: MembershipType[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-slate-600">
          <tr>
            <th className="py-2 pr-4">Membership type</th>
            <th className="py-2 pr-4">Category</th>
            <th className="py-2 pr-4">Covers</th>
            <th className="py-2 pr-4">Price</th>
            <th className="py-2 pr-4">Rules</th>
            <th className="py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((t) => {
            const rules = [
              t.max_age !== null && `Age ${t.max_age} or under`,
              t.sibling_order !== null && `Sibling ${t.sibling_order}`,
              t.requires_adult_member && "Needs adult member",
              t.requires_approval && "Needs approval",
            ].filter(Boolean);
            return (
              <tr key={t.id} aria-label={t.name}>
                <td className="py-2 pr-4">
                  <strong>{t.name}</strong> <span className="text-slate-500">({t.code})</span>
                  {t.description && <span className="block max-w-md text-xs text-slate-500">{t.description}</span>}
                </td>
                <td className="py-2 pr-4">{CATEGORY[t.category]}</td>
                <td className="py-2 pr-4">{COVER[t.cover]}</td>
                <td className="py-2 pr-4">{pounds(t.annual_price_pence)}</td>
                <td className="py-2 pr-4 text-slate-600">{rules.length ? rules.join(", ") : "None"}</td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    <Link href={`/admin/types?edit=${t.id}#edit`} className="text-sky-800 underline" aria-label={`Edit ${t.name}`}>
                      Edit
                    </Link>
                    <form action={setActive}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={t.is_open ? "false" : "true"} />
                      <SaveButton variant="link" pendingText="…" aria-label={`${t.is_open ? "Make inactive" : "Make active"}: ${t.name}`}>
                        {t.is_open ? "Make inactive" : "Make active"}
                      </SaveButton>
                    </form>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Membership types</h1>
      <AdminNav current="types" />
      <Notice message={saved} />
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}

      {edit && <TypeForm type={editing} nextOrder={nextOrder} />}

      <Card
        title={`Active (${active.length})`}
        action={
          !edit && (
            <Link href="/admin/types?edit=new#edit" className="rounded bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-950">
              Add a membership type
            </Link>
          )
        }
      >
        <p className="mb-2 text-sm text-slate-600">Offered to new members, on the Join page and for renewal.</p>
        {active.length ? table(active) : <p className="text-slate-700">No active membership types.</p>}
      </Card>

      <Card title={`Inactive (${inactive.length})`}>
        <p className="mb-2 text-sm text-slate-600">
          Not offered any more. Members who already have one keep it for the year, but can&apos;t renew it. Types are never deleted, so past
          memberships and reports still show them.
        </p>
        {inactive.length ? table(inactive) : <p className="text-slate-700">No inactive membership types.</p>}
      </Card>
    </div>
  );
}
