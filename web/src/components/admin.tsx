import Link from "next/link";
import { Card } from "./fields";

export function NotAllowed({ who = "club admins" }: { who?: string }) {
  return (
    <Card title="Admins only">
      <p className="text-slate-700">This page is for {who}.</p>
    </Card>
  );
}

export function AdminNav({ current }: { current: "members" | "new" | "applications" | "memberships" | "types" | "emails" | "import" }) {
  const links = [
    { key: "members", href: "/admin/members", label: "Members" },
    { key: "new", href: "/admin/members/new", label: "Add new member" },
    { key: "applications", href: "/admin/applications", label: "Applications" },
    { key: "memberships", href: "/admin/memberships", label: "Income" },
    { key: "types", href: "/admin/types", label: "Membership types" },
    { key: "emails", href: "/admin/emails", label: "Email templates" },
    { key: "import", href: "/admin/import", label: "Import spreadsheet" },
  ] as const;
  return (
    <nav aria-label="Admin" className="flex flex-wrap gap-4 border-b border-slate-200 pb-2 text-sm">
      {links.map((l) => (
        <Link
          key={l.key}
          href={l.href}
          className={l.key === current ? "font-semibold text-sky-900" : "text-slate-600 hover:text-sky-900"}
          aria-current={l.key === current ? "page" : undefined}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  active: "Paid",
  awaiting_payment: "Awaiting payment",
  pending_approval: "Awaiting approval",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
};
