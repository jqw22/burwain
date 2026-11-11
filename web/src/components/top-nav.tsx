"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The top bar links. The page you're on is shown bold and underlined.
// Admin pages count as Home, because they're reached from the Home page.
const LINKS = [
  { href: "/", label: "Home", match: (p: string) => p === "/" || p.startsWith("/admin") || p.startsWith("/membership") },
  { href: "/profile", label: "Your details", match: (p: string) => p.startsWith("/profile") || p.startsWith("/family") },
  { href: "/directory", label: "Directory", match: (p: string) => p.startsWith("/directory") },
];

export function TopNav() {
  const path = usePathname();
  return (
    <>
      {LINKS.map((l) => {
        const here = l.match(path);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={here ? "page" : undefined}
            className={
              here
                ? "font-bold text-sky-900 underline decoration-2 underline-offset-8"
                : "text-slate-700 hover:text-sky-900"
            }
          >
            {l.label}
          </Link>
        );
      })}
      <form action="/auth/signout" method="post" className="ml-auto">
        <button type="submit" className="text-sm text-slate-600 underline hover:text-sky-900">
          Sign out
        </button>
      </form>
    </>
  );
}
