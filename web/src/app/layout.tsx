import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Burwain Members",
  description: "Membership, renewals and club communications",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
            <Link href="/" className="font-semibold text-sky-900">
              Burwain Members
            </Link>
            <Link href="/membership" className="text-sm text-slate-700 hover:text-sky-900">
              Membership
            </Link>
            <Link href="/profile" className="text-sm text-slate-700 hover:text-sky-900">
              Your details
            </Link>
            <Link href="/family" className="text-sm text-slate-700 hover:text-sky-900">
              Family
            </Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
