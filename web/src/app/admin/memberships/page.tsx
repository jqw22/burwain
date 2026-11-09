import { AdminNav, NotAllowed, STATUS_LABEL } from "@/components/admin";
import { Card, Notice, SaveButton } from "@/components/fields";
import { meWithRole, pounds, ukDate } from "@/lib/me";
import { approveMembership, recordPayment } from "./actions";

type Year = { id: string; label: string; starts_on: string };
type Row = {
  id: string;
  membership_code: string;
  membership_type: string;
  status: string;
  price_pence: number;
  prorata_months: number;
  payer_name: string;
  people: string | null;
  created_at: string;
  paid_on: string | null;
  method: string | null;
};

const METHOD: Record<string, string> = {
  cash: "cash",
  cheque: "cheque",
  bank_transfer: "bank transfer",
  card: "card",
  direct_debit: "Direct Debit",
};
const SAVED: Record<string, string> = {
  paid: "Payment recorded. Those memberships are now marked as paid.",
  approved: "Membership approved. It's now awaiting payment.",
};
const ERRORS: Record<string, string> = {
  choose: "Please tick at least one membership to mark as paid.",
  payment: "We couldn't record that payment. Check the date isn't in the future and the memberships are still awaiting payment.",
  finance: "Only finance logins can record payments.",
  approve: "Only club admins can approve memberships.",
  approved: "We couldn't approve that membership. It may already have been approved.",
};

export default async function MembershipsPage({ searchParams }: PageProps<"/admin/memberships">) {
  const params = await searchParams;
  const { supabase, allowed: isAdmin } = await meWithRole("admin");
  const { data: financeRole } = await supabase.rpc("has_role", { r: "finance" });
  const isFinance = Boolean(financeRole);
  if (!isAdmin && !isFinance) return <NotAllowed who="club admins and finance" />;

  const [{ data: yearsData }, { data: currentId }] = await Promise.all([
    supabase.from("club_years").select("id, label, starts_on").order("starts_on", { ascending: false }),
    supabase.rpc("current_club_year_id"),
  ]);
  const years = (yearsData ?? []) as Year[];
  const wanted = typeof params.year === "string" ? params.year : "";
  const year = years.find((y) => y.id === wanted) ?? years.find((y) => y.id === currentId) ?? years[0];

  const { data } = year ? await supabase.rpc("club_memberships", { p_club_year_id: year.id }) : { data: [] };
  const rows = ((data ?? []) as Row[]).filter((r) => r.status !== "cancelled");
  const total = (status: string) => rows.filter((r) => r.status === status);
  const paid = total("active");
  const unpaid = total("awaiting_payment");
  const pending = total("pending_approval");
  const sum = (list: Row[]) => pounds(list.reduce((s, r) => s + r.price_pence, 0));

  const saved = typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Income</h1>
      <AdminNav current="memberships" />
      <Notice message={saved} />
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}

      <form className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-sm font-medium">Club year</span>
          <select
            name="year"
            defaultValue={year?.id}
            className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2"
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.label}
              </option>
            ))}
          </select>
        </label>
        <SaveButton variant="secondary">Show</SaveButton>
      </form>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Paid</dt>
          <dd className="text-xl font-semibold">
            {paid.length} <span className="text-base font-normal text-slate-600">({sum(paid)})</span>
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Awaiting payment</dt>
          <dd className="text-xl font-semibold">
            {unpaid.length} <span className="text-base font-normal text-slate-600">({sum(unpaid)})</span>
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Awaiting approval</dt>
          <dd className="text-xl font-semibold">{pending.length}</dd>
        </div>
      </dl>

      {pending.length > 0 && (
        <Card title="Awaiting committee approval">
          <ul className="divide-y divide-slate-100">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{r.membership_type}</strong> for {r.people}: {pounds(r.price_pence)}
                  <span className="ml-2 text-sm text-slate-600">asked on {ukDate(r.created_at)}</span>
                </span>
                {isAdmin && (
                  <form action={approveMembership}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="year" value={year?.id} />
                    <SaveButton aria-label={`Approve ${r.membership_type} for ${r.people}`} pendingText="Approving…">
                      Approve
                    </SaveButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`All memberships for ${year?.label ?? "this year"}`}>
        {rows.length === 0 ? (
          <p className="text-slate-600">No memberships yet.</p>
        ) : (
          <form action={recordPayment} className="space-y-4">
            <input type="hidden" name="year" value={year?.id} />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-600">
                  <tr>
                    {isFinance && <th className="py-2 pr-2"><span className="sr-only">Select</span></th>}
                    <th className="py-2 pr-4">Paid by</th>
                    <th className="py-2 pr-4">Membership</th>
                    <th className="py-2 pr-4">Covers</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      {isFinance && (
                        <td className="py-2 pr-2">
                          {r.status === "awaiting_payment" && (
                            <input
                              type="checkbox"
                              name="membership_id"
                              value={r.id}
                              aria-label={`Mark ${r.membership_type} for ${r.people} as paid`}
                            />
                          )}
                        </td>
                      )}
                      <td className="py-2 pr-4">{r.payer_name}</td>
                      <td className="py-2 pr-4">
                        {r.membership_type} <span className="text-slate-500">({r.membership_code})</span>
                      </td>
                      <td className="py-2 pr-4">{r.people}</td>
                      <td className="py-2 pr-4">
                        {pounds(r.price_pence)}
                        {r.prorata_months < 12 && <span className="text-slate-500"> ({r.prorata_months} months)</span>}
                      </td>
                      <td className="py-2">
                        {STATUS_LABEL[r.status] ?? r.status}
                        {r.paid_on && (
                          <span className="block text-xs text-slate-500">
                            {ukDate(r.paid_on)}
                            {r.method && `, ${METHOD[r.method] ?? r.method}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isFinance && unpaid.length > 0 && (
              <fieldset className="space-y-3 rounded border border-slate-200 p-4">
                <legend className="px-1 font-medium">Record a payment for the ticked memberships</legend>
                <div className="flex flex-wrap items-end gap-4">
                  <label className="block">
                    <span className="text-sm font-medium">Paid by</span>
                    <select name="method" required className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2">
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="cheque">Cheque</option>
                      <option value="cash">Cash</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium">Date received</span>
                    <input
                      type="date"
                      name="paid_on"
                      required
                      max={today}
                      defaultValue={today}
                      className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2"
                    />
                  </label>
                  <SaveButton pendingText="Recording…">Record payment</SaveButton>
                </div>
                <p className="text-xs text-slate-500">
                  Card and Direct Debit payments will be recorded automatically once online payments are switched on.
                </p>
              </fieldset>
            )}
            {!isFinance && unpaid.length > 0 && (
              <p className="text-sm text-slate-600">Payments are recorded by the finance logins.</p>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}
