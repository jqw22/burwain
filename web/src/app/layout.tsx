import type { Metadata } from "next";
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
          <div className="mx-auto max-w-3xl px-4 py-4 font-semibold text-sky-900">
            Burwain Members
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
