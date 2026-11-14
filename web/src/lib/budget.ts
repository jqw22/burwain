// Shared by the Budget screen and its save action.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "£1,200.50" -> 120050 pence; blank -> 0; anything else (letters, minus, 3 decimals) -> null.
export function parsePounds(text: string): number | null {
  const v = text.replace(/[£,\s]/g, "");
  if (v === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(v) && !/^\.\d{1,2}$/.test(v)) return null;
  const pence = Math.round(Number(v) * 100);
  return pence > 2_000_000_000 ? null : pence;
}

// 120050 -> "1,200.50"; 0 -> "" (an empty cell).
export function cellText(pence: number) {
  return pence === 0 ? "" : (pence / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Totals: always 2 decimal places, with a minus sign when below zero.
export function money(pence: number) {
  const abs = (Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${pence < 0 ? "−" : ""}£${abs}`;
}

// Budgets are usually set up ahead, so from October the screen opens on next year.
export function defaultBudgetYear(now = new Date()) {
  const [y, m] = now.toLocaleDateString("en-CA", { timeZone: "Europe/London" }).split("-").map(Number);
  return m >= 10 ? y + 1 : y;
}
