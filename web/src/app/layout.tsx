import type { Metadata } from "next";
import Link from "next/link";
import { TopNav } from "@/components/top-nav";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Burwain Members",
  description: "Membership, renewals and club communications",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Visitors who aren't logged in (on the Join or login pages) only see a Log in link.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  // The Admin link is only for admin and finance logins (superadmins pass every role check).
  let showAdmin = false;
  if (signedIn) {
    const [{ data: isAdmin }, { data: isFinance }] = await Promise.all([
      supabase.rpc("has_role", { r: "admin" }),
      supabase.rpc("has_role", { r: "finance" }),
    ]);
    showAdmin = Boolean(isAdmin || isFinance);
  }
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
            {signedIn ? (
              <TopNav showAdmin={showAdmin} />
            ) : (
              <>
                <span className="font-semibold text-sky-900">Burwain</span>
                <Link href="/login" className="text-sm text-slate-700 hover:text-sky-900">
                  Log in
                </Link>
              </>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
