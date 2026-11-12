// Matches membership_quote() in the database: full price until a month after the type's start date,
// then the months left (counting this month) out of the type's months.
export function quote(t: { annual_price_pence: number; starts_on: string; ends_on: string }, today: string) {
  const [sy, sm] = t.starts_on.split("-").map(Number);
  const [ey, em] = t.ends_on.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  const total = (ey - sy) * 12 + em - sm + 1;
  const graceEnd = new Date(`${t.starts_on}T00:00:00Z`);
  graceEnd.setUTCDate(graceEnd.getUTCDate() + 30);
  const months =
    today <= graceEnd.toISOString().slice(0, 10) ? total : Math.max(1, Math.min(total, (ey - ty) * 12 + em - tm + 1));
  return { price: Math.round((t.annual_price_pence * months) / total), months, total };
}

// "1 Jan 2027 to 31 Dec 2027"
export function typeDates(t: { starts_on: string; ends_on: string }) {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return `${f(t.starts_on)} to ${f(t.ends_on)}`;
}

// The same date a year later (29 February becomes 28 February), as the database's "+ 1 year" does.
export function yearLater(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

// Today's date in the UK, as YYYY-MM-DD.
export function ukToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
