import Link from "next/link";
import { Card } from "./fields";

export function NotAllowed({ who = "club admins" }: { who?: string }) {
  return (
    <Card title="Admins only">
      <p className="text-slate-700">This page is for {who}.</p>
    </Card>
  );
}

// Each Home page section has its own bar of links: Membership admin, Communications admin and Finance admin.
const SECTIONS = {
  members: "membership",
  applications: "membership",
  types: "membership",
  import: "membership",
  emails: "comms",
  contacts: "comms",
  memberships: "finance",
  transactions: "finance",
  categories: "finance",
} as const;
const LINKS = [
  { key: "members", href: "/admin/members", label: "Members" },
  { key: "applications", href: "/admin/applications", label: "Applications" },
  { key: "types", href: "/admin/types", label: "Membership types" },
  { key: "import", href: "/admin/import", label: "Import" },
  { key: "emails", href: "/admin/emails", label: "Email templates" },
  { key: "contacts", href: "/admin/contacts/new", label: "Add contact" },
  { key: "memberships", href: "/admin/memberships", label: "Income" },
  { key: "transactions", href: "/admin/transactions", label: "Transactions" },
  { key: "categories", href: "/admin/categories", label: "Categories" },
] as const;
const SECTION_NAME = { membership: "Membership admin", comms: "Communications admin", finance: "Finance admin" };

export function AdminNav({ current }: { current: keyof typeof SECTIONS }) {
  const section = SECTIONS[current];
  return (
    <nav aria-label={SECTION_NAME[section]} className="flex flex-wrap gap-4 border-b border-slate-200 pb-2 text-sm">
      {LINKS.filter((l) => SECTIONS[l.key] === section).map((l) => (
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
