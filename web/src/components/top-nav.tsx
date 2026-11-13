"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// The top bar links. The page you're on is shown bold and underlined.
// Member is the landing page. Admin comes after Directory, for admin and finance logins only,
// and admin pages count as Admin because they're reached from it.
const LINKS = [
  { href: "/profile", label: "Member", match: (p: string) => p.startsWith("/profile") || p.startsWith("/family") || p.startsWith("/membership") },
  { href: "/directory", label: "Directory", match: (p: string) => p.startsWith("/directory") },
];
const ADMIN = { href: "/", label: "Admin", match: (p: string) => p === "/" || p.startsWith("/admin") };

export function TopNav({ showAdmin }: { showAdmin: boolean }) {
  const path = usePathname();
  const link = (l: typeof ADMIN, extra = "") => {
    const here = l.match(path);
    return (
      <Link
        key={l.href}
        href={l.href}
        aria-current={here ? "page" : undefined}
        className={
          (here ? "font-bold text-sky-900 underline decoration-2 underline-offset-8" : "text-slate-700 hover:text-sky-900") +
          extra
        }
      >
        {l.label}
      </Link>
    );
  };
  return (
    <>
      {LINKS.map((l) => link(l))}
      {showAdmin && link(ADMIN)}
      <form action="/auth/signout" method="post" className="ml-auto">
        <button type="submit" className="text-sm text-slate-600 underline hover:text-sky-900">
          Sign out
        </button>
      </form>
    </>
  );
}
