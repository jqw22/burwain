"use client";

import { addButton } from "@/components/person-fields";

import { MAX_BOATS, type Boat } from "@/lib/boats";

export type { Boat };

export function pounds(pence: number) {
  return `£${(pence / 100).toFixed(pence % 100 === 0 ? 0 : 2)}`;
}

// Boat storage rows: class and sail number for each boat, with Add a boat / Remove buttons.
// The parent holds the list so it can add the storage to the total. Inputs are named
// boat_class and sail_number (one of each per boat), read with form.getAll().
export function BoatFields({
  boats,
  onChange,
  max,
  price,
}: {
  boats: Boat[];
  onChange: (boats: Boat[]) => void;
  max: number;
  price: number;
}) {
  const set = (i: number, key: keyof Boat, value: string) =>
    onChange(boats.map((b, j) => (j === i ? { ...b, [key]: value } : b)));
  const input = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";
  return (
    <fieldset className="space-y-3" aria-label="Boat storage">
      <legend className="font-medium">Boat storage</legend>
      <p className="text-sm text-slate-600">
        {pounds(price)} per sailing dinghy, including its road trailer, for the same dates as the membership. Up to{" "}
        {MAX_BOATS} boats per membership.
      </p>
      {boats.map((b, i) => (
        <div key={i} role="group" aria-label={`Boat ${i + 1}`} className="flex flex-wrap items-end gap-3 rounded border border-slate-200 p-3">
          <label className="block min-w-40 flex-1">
            <span className="text-sm font-medium">Class</span>
            <input
              name="boat_class"
              required
              value={b.boat_class}
              onChange={(e) => set(i, "boat_class", e.target.value)}
              placeholder="e.g. Laser"
              className={input}
            />
          </label>
          <label className="block min-w-32 flex-1">
            <span className="text-sm font-medium">Sail number</span>
            <input
              name="sail_number"
              required
              value={b.sail_number}
              onChange={(e) => set(i, "sail_number", e.target.value)}
              className={input}
            />
          </label>
          <span className="py-2 text-sm text-slate-700">{pounds(price)}</span>
          <button type="button" className={addButton} onClick={() => onChange(boats.filter((_, j) => j !== i))}>
            Remove boat {i + 1}
          </button>
        </div>
      ))}
      {boats.length < max ? (
        <button type="button" className={addButton} onClick={() => onChange([...boats, { boat_class: "", sail_number: "" }])}>
          Add a boat
        </button>
      ) : (
        <p className="text-sm text-slate-600">That&apos;s the most boats that can be stored on one membership.</p>
      )}
    </fieldset>
  );
}
