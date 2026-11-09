import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Person = { id: string; first_name: string; last_name: string };
type HistoryRow = {
  person_id: string;
  club_year: string;
  starts_on: string;
  membership_type: string;
  status: string;
};

const STATUS: Record<string, string> = {
  active: "Paid",
  awaiting_payment: "Awaiting payment",
  pending_approval: "Awaiting admin approval",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
};

export default async function HomePage() {
  const supabase = await createClient();

  // First sign-in: attach this login to the member record with the same email.
  const { data: personId } = await supabase.rpc("link_my_account");

  if (!personId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-semibold">We couldn&apos;t find your membership</h1>
        <p className="mt-2 text-slate-700">
          You&apos;re signed in, but this email address doesn&apos;t match a member record. Please
          contact the membership secretary so they can link your account.
        </p>
        <SignOut />
      </div>
    );
  }

  const [{ data: me }, { data: historyData }, { data: isAdmin }, { data: isFinance }] = await Promise.all([
    supabase.from("people").select("id, first_name, last_name").eq("id", personId).single<Person>(),
    supabase.rpc("membership_history"),
    supabase.rpc("has_role", { r: "admin" }),
    supabase.rpc("has_role", { r: "finance" }),
  ]);

  const history = (historyData ?? []) as HistoryRow[];
  const waiting = isAdmin ? ((await supabase.rpc("pending_applications")).data ?? []).length : 0;
  const latestYear = history.map((h) => h.starts_on).sort().at(-1);
  const current = history.filter((h) => h.person_id === personId && h.starts_on === latestYear);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Welcome, {me?.first_name}</h1>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-semibold">Your membership</h2>
        {current.length === 0 ? (
          <p className="mt-2 text-slate-600">You don&apos;t have a membership for this year yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {current.map((m) => (
              <li key={m.membership_type}>
                {m.membership_type} ({m.club_year}): <strong>{STATUS[m.status] ?? m.status}</strong>
              </li>
            ))}
          </ul>
        )}
        <Link href="/profile#renew" className="mt-3 inline-block text-sky-800 underline">
          See or renew your membership
        </Link>
      </section>
      {(isAdmin || isFinance) && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Club admin</h2>
          <ul className="mt-2 space-y-1">
            {isAdmin && (
              <>
                <li>
                  <Link href="/admin/members" className="text-sky-800 underline">
                    Members
                  </Link>
                </li>
                <li>
                  <Link href="/admin/members/new" className="text-sky-800 underline">
                    Add new member
                  </Link>
                </li>
                <li>
                  <Link href="/admin/applications" className="text-sky-800 underline">
                    Applications
                  </Link>
                  {waiting > 0 && <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-sm text-amber-900">{waiting} waiting</span>}
                </li>
              </>
            )}
            <li>
              <Link href="/admin/memberships" className="text-sky-800 underline">
                Payments
              </Link>
            </li>
          </ul>
        </section>
      )}
      <SignOut />
    </div>
  );
}

function SignOut() {
  return (
    <form action="/auth/signout" method="post" className="mt-4">
      <button type="submit" className="text-sm text-slate-600 underline">
        Sign out
      </button>
    </form>
  );
}
