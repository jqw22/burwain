"use client";

import { useState } from "react";

type Category = { id: string; name: string; direction: "in" | "out" };

// Money in or out, then a category list showing only the categories for that direction.
export function DirectionAndCategory({
  categories,
  direction: initialDirection,
  categoryId,
}: {
  categories: Category[];
  direction: "in" | "out";
  categoryId: string;
}) {
  const [direction, setDirection] = useState(initialDirection);
  const [category, setCategory] = useState(categoryId);
  const shown = categories.filter((c) => c.direction === direction);
  const choose = (d: "in" | "out") => {
    setDirection(d);
    if (!categories.some((c) => c.id === category && c.direction === d)) setCategory("");
  };

  return (
    <>
      <fieldset>
        <legend className="text-sm font-medium">Money in or out?</legend>
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
          <label className="flex items-center gap-2">
            <input type="radio" name="direction" value="out" checked={direction === "out"} onChange={() => choose("out")} />
            Money out (the club paid)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="direction" value="in" checked={direction === "in"} onChange={() => choose("in")} />
            Money in (the club received)
          </label>
        </div>
      </fieldset>
      <label className="block">
        <span className="text-sm font-medium">Category</span>
        <select
          name="category_id"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"
        >
          <option value="">Uncategorised</option>
          {shown.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
