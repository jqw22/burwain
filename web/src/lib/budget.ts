// Shared by the Budget screen and its save action.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Budgets are in whole pounds (James: 0 decimal places keeps the columns narrow).
// "£1,200" -> 120000 pence; blank -> 0; anything else (letters, minus, pence) -> null.
// "1,200.00" is accepted as whole pounds.
export function parsePounds(text: string): number | null {
  const v = text.replace(/[£,\s]/g, "").replace(/\.0{1,2}$/, "");
  if (v === "") return 0;
  if (!/^\d+$/.test(v)) return null;
  const pence = Number(v) * 100;
  return pence > 2_000_000_000 ? null : pence;
}

const whole = (pence: number) => Math.round(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 });

// 120000 -> "1,200"; 0 -> "" (an empty cell).
export function cellText(pence: number) {
  return pence === 0 ? "" : whole(pence);
}

// Totals: whole pounds, with a minus sign when below zero.
export function money(pence: number) {
  return `${pence < 0 ? "−" : ""}£${whole(Math.abs(pence))}`;
}

// Budgets are usually set up ahead, so from October the screen opens on next year.
export function defaultBudgetYear(now = new Date()) {
  const [y, m] = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" }).split("-").map(Number);
  return m >= 10 ? y + 1 : y;
}
