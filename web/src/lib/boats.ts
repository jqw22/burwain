export type Boat = { boat_class: string; sail_number: string };

export const MAX_BOATS = 3;

// Reads the boats a form sent.
export function boatsFromForm(form: FormData): Boat[] {
  const classes = form.getAll("boat_class").map((v) => String(v).trim());
  const sails = form.getAll("sail_number").map((v) => String(v).trim());
  return classes.map((c, i) => ({ boat_class: c, sail_number: sails[i] ?? "" })).filter((b) => b.boat_class || b.sail_number);
}
