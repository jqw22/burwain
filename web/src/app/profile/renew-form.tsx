"use client";

import { useState } from "react";
import { SaveButton } from "@/components/fields";
import { typeDates } from "@/lib/quote";

export type RenewPerson = { id: string; name: string; age: number | null };
export type RenewType = {
  id: string;
  name: string;
  description: string | null;
  cover: "individual" | "dual" | "family" | "junior";
  annual_price_pence: number;
  max_age: number | null;
  starts_on: string;
  ends_on: string;
};

const MAX_FAMILY = 4;

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}

// Does this type suit the people ticked? Checks how many people it covers and any age limit.
function fits(t: RenewType, people: RenewPerson[]) {
  const n = people.length;
  if (n === 0) return false;
  if ((t.cover === "individual" || t.cover === "junior") && n !== 1) return false;
  if (t.cover === "dual" && n !== 2) return false;
  if (t.cover === "family" && n > MAX_FAMILY) return false;
  if (t.max_age !== null && people.some((p) => p.age === null || p.age > t.max_age!)) return false;
  return true;
}

// Renewing for next year: tick who the membership is for, then pick any of next year's types that suits them.
export function RenewForm({
  yearId,
  yearLabel,
  people,
  types,
  suggested,
  action,
  extra = {},
  button,
}: {
  yearId: string;
  yearLabel: string;
  people: RenewPerson[];
  types: RenewType[];
  suggested?: string;
  // Admins renew straight away with their own action; members go on to the confirmation screen.
  action?: (form: FormData) => void | Promise<void>;
  extra?: Record<string, string>;
  button?: string;
}) {
  const [ticked, setTicked] = useState<string[]>(people.map((p) => p.id));
  const chosen = people.filter((p) => ticked.includes(p.id));
  const options = types.filter((t) => fits(t, chosen));
  const [typeId, setTypeId] = useState(suggested ?? "");
  const value = options.some((t) => t.id === typeId) ? typeId : "";
  const type = options.find((t) => t.id === value);

  return (
    <form
      {...(action ? { action } : { action: "/profile/renew", method: "get" })}
      className="mt-2 space-y-3"
      aria-label={button ?? `Renew for ${yearLabel}`}
    >
      {Object.entries(extra).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input type="hidden" name="club_year_id" value={yearId} />
      <input type="hidden" name="remaining" value={people.length - chosen.length} />
      <fieldset>
        <legend className="text-slate-700">Who is this membership for?</legend>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="person"
                value={p.id}
                checked={ticked.includes(p.id)}
                onChange={(e) => setTicked(e.target.checked ? [...ticked, p.id] : ticked.filter((x) => x !== p.id))}
              />
              {p.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="text-slate-700">Membership type for {yearLabel}</span>
        <select
          name="type_id"
          required
          value={value}
          onChange={(e) => setTypeId(e.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"
        >
          <option value="">{options.length ? "Choose…" : "No membership type suits the people ticked"}</option>
          {options.map((t) => (
            <option key={t.id} value={t.id}>
              {t.cover === "junior" ? "Junior" : t.name}: {pounds(t.annual_price_pence)}
            </option>
          ))}
        </select>
        {type && (
          <span className="mt-1 block text-sm text-slate-600">
            {typeDates(type)}.{type.description && ` ${type.description}`}
          </span>
        )}
        {type?.cover === "junior" && (
          <span className="mt-1 block text-sm text-slate-600">
            Second and third juniors in a family get the sibling price automatically.
          </span>
        )}
      </label>
      {chosen.length < people.length && chosen.length > 0 && (
        <p className="text-sm text-slate-600">
          You can renew the others separately afterwards, on a different membership type if you like.
        </p>
      )}
      <SaveButton pendingText={action ? "Saving…" : "Opening…"}>{button ?? `Renew for ${yearLabel}`}</SaveButton>
    </form>
  );
}
