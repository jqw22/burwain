import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminHomePage() {
  const supabase = await createClient();

  // First sign-in: attach this login to the member record with the same email.
  const { data: personId } = await supabase.rpc("link_my_account");

  // An unmatched login is explained on Home.
  if (!personId) redirect("/");

  const [{ data: isAdmin }, { data: isFinance }, { data: seesLogins }] = await Promise.all([
    supabase.rpc("has_role", { r: "admin" }),
    supabase.rpc("has_role", { r: "finance" }),
    supabase.rpc("can_view_login_activity"),
  ]);
  // This Admin page is for admin and finance logins; members go back to Home.
  if (!isAdmin && !isFinance) redirect("/");
  const waiting = ((await supabase.rpc("pending_applications")).data ?? []).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      {/* Finance logins see the Membership and Communications areas too, without the pages that only make changes. */}
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Membership admin</h2>
          <ul className="mt-2 space-y-1">
            <li>
              <Link href="/admin/members" className="text-sky-800 underline">
                Members
              </Link>
            </li>
            <li>
              <Link href="/admin/applications" className="text-sky-800 underline">
                Applications
              </Link>
              {waiting > 0 && <span className="ml-2 rounded bg-amber-50 px-2 py-0.5 text-sm text-amber-900">{waiting} waiting</span>}
            </li>
            <li>
              <Link href="/admin/types" className="text-sky-800 underline">
                Membership types
              </Link>
            </li>
            <li>
              <Link href="/admin/boats" className="text-sky-800 underline">
                Boats
              </Link>
            </li>
            <li>
              <Link href="/admin/titles" className="text-sky-800 underline">
                Club titles
              </Link>
            </li>
            {isAdmin && (
            <li>
              <Link href="/admin/import" className="text-sky-800 underline">
                Import
              </Link>
            </li>
            )}
            {seesLogins && (
            <li>
              <Link href="/admin/logins" className="text-sky-800 underline">
                Login activity
              </Link>
            </li>
            )}
            <li>
              {/* Temporary: the public join form will be linked from the club website later. */}
              <Link href="/join" className="text-sky-800 underline">
                Public join form
              </Link>
              <span className="ml-2 text-sm text-slate-500">(temporary link)</span>
            </li>
          </ul>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Communications admin</h2>
          <ul className="mt-2 space-y-1">
            {isAdmin && (
            <li>
              <Link href="/admin/emails/send" className="text-sky-800 underline">
                Send email
              </Link>
            </li>
            )}
            {isAdmin && (
            <li>
              <Link href="/admin/contacts/new" className="text-sky-800 underline">
                Add contact
              </Link>
            </li>
            )}
            <li>
              <Link href="/admin/emails" className="text-sky-800 underline">
                Templates
              </Link>
            </li>
            <li>
              <Link href="/admin/emails/log" className="text-sky-800 underline">
                Email log
              </Link>
            </li>
          </ul>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Finance admin</h2>
          <ul className="mt-2 space-y-1">
            <li>
              <Link href="/admin/transactions" className="text-sky-800 underline">
                Transactions
              </Link>
            </li>
            <li>
              <Link href="/admin/memberships" className="text-sky-800 underline">
                Income
              </Link>
            </li>
            <li>
              <Link href="/admin/actual" className="text-sky-800 underline">
                Actual
              </Link>
            </li>
            <li>
              <Link href="/admin/budget" className="text-sky-800 underline">
                Budget
              </Link>
            </li>
            <li>
              <Link href="/admin/categories" className="text-sky-800 underline">
                Categories
              </Link>
            </li>
          </ul>
        </section>
    </div>
  );
}
