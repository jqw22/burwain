import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Checkbox, Field, Notice, SaveButton } from "@/components/fields";
import { meWithRole, pounds } from "@/lib/me";
import { typeDates, ukToday, yearLater } from "@/lib/quote";
import { copyPeriod, copyType, saveStoragePrices, saveType, setActive } from "./actions";

type MembershipType = {
  id: string;
  starts_on: string;
  ends_on: string;
  code: string;
  name: string;
  description: string | null;
  category: "sailing" | "non_sailing";
  cover: "individual" | "dual" | "family" | "junior";
  annual_price_pence: number;
  max_age: number | null;
  requires_adult_member: boolean;
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
  copied: "Copied with the dates a year later. Check the details and price below, then save.",
  copiedall: "Membership types copied with the dates a year later. Check the prices, and make inactive any you don't want.",
  deactivated: "Membership type is now inactive. Existing memberships aren't affected.",
  storage: "Boat storage prices saved. They apply to boats added from now on.",
};
const ERRORS: Record<string, string> = {
  admin: "Only club admins can change membership types.",
  name: "Please give the membership type a name.",
  code: "The short code must be 1 to 10 capital letters or numbers, with no spaces (for example SUP or J1).",
  price: "Please enter the price in pounds, for example 95 or 95.50.",
  age: "The age limit must be a whole number of years, or left blank.",
  sibling: "The junior sibling number must be 1 to 9, or left blank.",
  order: "The list position must be a whole number.",
  duplicate: "Another membership type starting on the same day already uses that short code. Please choose a different one.",
  copy: "We couldn't copy that. There may already be a copy starting a year later.",
  dates: "Please give a start date and an end date, with the end date on or after the start date.",
  save: "We couldn't save that. Please try again.",
  storage: "Please enter both boat storage prices in pounds, for example 35 or 35.50.",
};

const select = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";

function TypeForm({ type, nextOrder, defaults }: { type: MembershipType | null; nextOrder: number; defaults: { starts_on: string; ends_on: string } }) {
  return (
    <Card title={type ? `Edit ${type.name} (${typeDates(type)})` : "Add a membership type"} id="edit">
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
          label="Start date"
          name="starts_on"
          type="date"
          defaultValue={type?.starts_on ?? defaults.starts_on}
          required
          hint="The first day memberships of this type cover. Any date, for example 1 June."
        />
        <Field
          label="End date"
          name="ends_on"
          type="date"
          defaultValue={type?.ends_on ?? defaults.ends_on}
          required
          hint="The last day they cover. The type isn't offered after this date."
        />
        <Field
          label="Price for the whole period (£)"
          name="price"
          defaultValue={type ? (type.annual_price_pence / 100).toFixed(2) : ""}
          required
          hint="For the whole period from the start date to the end date. Brand-new members joining later pay for the months left; existing and lapsed members pay the full price. Memberships already taken keep their price."
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
          hint="For example 17 for juniors. Leave blank for no limit. Checked on the start date."
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
          <Checkbox label="Needs an adult member in the same family (like Junior)" name="requires_adult_member" defaultChecked={type?.requires_adult_member} />
        </div>
        <div className="flex items-center gap-4 sm:col-span-2">
          <SaveButton>{type ? "Save changes" : "Add membership type"}</SaveButton>
          <Link href="/admin/types" className="text-sm text-slate-600 underline">Cancel</Link>
        </div>
      </form>
      {type && (
        <form action={setActive} className="mt-6 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
          <input type="hidden" name="id" value={type.id} />
          <input type="hidden" name="active" value={type.is_open ? "false" : "true"} />
          <span className="text-sm text-slate-700">
            {type.is_open
              ? `${type.name} is active: offered to new members, on the Join page and for renewal.`
              : `${type.name} is inactive: not offered to anyone.`}
          </span>
          <SaveButton variant="secondary" pendingText="…">
            {type.is_open ? "Make inactive" : "Make active"}
          </SaveButton>
        </form>
      )}
    </Card>
  );
}

export default async function TypesPage({ searchParams }: PageProps<"/admin/types">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const { data } = await supabase
    .from("membership_types")
    .select("*")
    .order("starts_on")
    .order("sort_order")
    .order("name");
  const types = (data ?? []) as MembershipType[];
  const { data: storageData } = await supabase.from("boat_storage_options").select("id, members_rate, price_pence");
  const storage = (storageData ?? []) as { id: string; members_rate: boolean; price_pence: number }[];
  const storagePrice = (members: boolean) => storage.find((o) => o.members_rate === members)?.price_pence ?? 0;
  const today = ukToday();
  const current = types.filter((t) => t.is_open && t.ends_on >= today);
  const inactive = types.filter((t) => !t.is_open && t.ends_on >= today);
  const ended = types.filter((t) => t.ends_on < today).reverse();
  const taken = new Set(types.map((t) => `${t.code}|${t.starts_on}`));
  const notCopied = (t: MembershipType) => !taken.has(`${t.code}|${yearLater(t.starts_on)}`);

  // Current and upcoming types, grouped by their dates.
  const periods = [...new Map(current.map((t) => [`${t.starts_on}|${t.ends_on}`, { starts_on: t.starts_on, ends_on: t.ends_on }])).values()];

  const edit = typeof params.edit === "string" ? params.edit : "";
  const editing = types.find((t) => t.id === edit) ?? null;
  const nextOrder = Math.max(0, ...types.map((t) => t.sort_order)) + 10;
  // New types start on 1 January: this year, or next year once renewals for it are close.
  const y = Number(today.slice(0, 4)) + (today.slice(5) >= "11-01" ? 1 : 0);
  const defaults = { starts_on: `${y}-01-01`, ends_on: `${y}-12-31` };

  const saved =
    params.saved === "copiedall" && params.count === "0"
      ? "Those types have all been copied already."
      : typeof params.saved === "string"
        ? SAVED[params.saved]
        : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  const table = (list: MembershipType[], label: string) => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label={label}>
        <thead className="text-slate-600">
          <tr>
            <th className="py-2 pr-4">Membership type</th>
            <th className="py-2 pr-4">Category</th>
            <th className="py-2 pr-4">Covers</th>
            <th className="py-2 pr-4">Dates</th>
            <th className="py-2 pr-4">Price</th>
            <th className="py-2"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {list.map((t) => {
            const rules = [
              t.max_age !== null && `Age ${t.max_age} or under`,
              t.sibling_order !== null && `Sibling ${t.sibling_order}`,
              t.requires_adult_member && "Needs adult member",
            ].filter(Boolean);
            return (
              <tr key={t.id} aria-label={t.name}>
                <td className="py-2 pr-4">
                  <strong>{t.name}</strong> <span className="text-slate-500">({t.code})</span>
                  {t.description && <span className="block max-w-md text-xs text-slate-500">{t.description}</span>}
                  {rules.length > 0 && <span className="block max-w-md text-xs font-medium text-slate-700">{rules.join(" · ")}</span>}
                </td>
                <td className="py-2 pr-4">{CATEGORY[t.category]}</td>
                <td className="py-2 pr-4">{COVER[t.cover]}</td>
                <td className="py-2 pr-4">
                  {typeDates(t)}
                  {t.starts_on > today && <span className="block text-xs text-sky-800">Starts later</span>}
                </td>
                <td className="py-2 pr-4">{pounds(t.annual_price_pence)}</td>
                <td className="py-2">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    <Link href={`/admin/types?edit=${t.id}#edit`} className="text-sky-800 underline" aria-label={`Edit ${t.name}`}>
                      Edit
                    </Link>
                    {notCopied(t) && (
                      <form action={copyType}>
                        <input type="hidden" name="id" value={t.id} />
                        <button
                          type="submit"
                          className="text-sky-800 underline"
                          aria-label={`Copy ${t.name} to a year later`}
                          title="Make a new type with the same details and the dates a year later"
                        >
                          Copy
                        </button>
                      </form>
                    )}
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
      <AdminNav current="types" />
      <Notice message={saved} />
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}

      <p className="text-slate-700">
        Each membership type has its own start date, end date and price, so it can cover any period (for example June to March).
        Memberships of a type run between its dates. A type is offered on the Join page from 60 days before it starts, and is no
        longer offered after its end date. To set up next year, copy a type: the copy has the same details with the dates a year
        later, ready to change.
      </p>

      {edit && <TypeForm type={editing} nextOrder={nextOrder} defaults={defaults} />}

      <Card
        title={`Current and upcoming (${current.length})`}
        action={
          !edit && (
            <Link href="/admin/types?edit=new#edit" className="rounded bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-950">
              Add a membership type
            </Link>
          )
        }
      >
        <p className="mb-2 text-sm text-slate-600">Active types that haven&apos;t ended: offered to new members and for renewal.</p>
        {periods.length === 0 && <p className="text-slate-700">No active membership types.</p>}
        <div className="space-y-6">
          {periods.map((p) => {
            const list = current.filter((t) => t.starts_on === p.starts_on && t.ends_on === p.ends_on);
            const toCopy = list.filter(notCopied).length;
            const later = { starts_on: yearLater(p.starts_on), ends_on: yearLater(p.ends_on) };
            return (
              <div key={`${p.starts_on}|${p.ends_on}`}>
                <h3 className="font-medium text-slate-900">{typeDates(p)}</h3>
                {table(list, `Types for ${typeDates(p)}`)}
                {toCopy > 0 && (
                  <form action={copyPeriod} className="mt-2 flex flex-wrap items-center gap-3 rounded border border-sky-200 bg-sky-50 p-3">
                    <input type="hidden" name="starts_on" value={p.starts_on} />
                    <input type="hidden" name="ends_on" value={p.ends_on} />
                    <span className="text-sm text-sky-950">
                      Copy {toCopy === list.length ? (toCopy === 1 ? "this type" : `all ${toCopy} types`) : `the ${toCopy} not yet copied`}, with
                      the dates moved to {typeDates(later)} and the same prices to change afterwards.
                    </span>
                    <SaveButton variant="secondary" pendingText="Copying…" aria-label={`Copy the types for ${typeDates(p)} to a year later`}>
                      {toCopy === 1 ? "Copy it" : "Copy these types"}
                    </SaveButton>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Boat storage prices" id="storage">
        <form action={saveStoragePrices} className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Members rate (£)"
            name="members_price"
            required
            defaultValue={(storagePrice(true) / 100).toFixed(2).replace(/\.00$/, "")}
            hint="Per sailing dinghy, including road trailer. Members add boats when they renew or join."
          />
          <Field
            label="Non-members rate (£)"
            name="non_members_price"
            required
            defaultValue={(storagePrice(false) / 100).toFixed(2).replace(/\.00$/, "")}
            hint="Charged by an admin to someone who didn't renew but left their boat at the club."
          />
          <div className="flex items-end">
            <SaveButton pendingText="Saving…">Save storage prices</SaveButton>
          </div>
        </form>
      </Card>

      <Card title={`Inactive (${inactive.length})`}>
        <p className="mb-2 text-sm text-slate-600">Not offered to anyone. Members who already have one keep it.</p>
        {inactive.length ? table(inactive, "Inactive types") : <p className="text-slate-700">No inactive membership types.</p>}
      </Card>

      <Card title={`Ended (${ended.length})`}>
        <p className="mb-2 text-sm text-slate-600">
          Past their end date, so no longer offered. Types are never deleted, so past memberships and reports still show them.
        </p>
        {ended.length ? table(ended, "Ended types") : <p className="text-slate-700">No ended membership types.</p>}
      </Card>
    </div>
  );
}
