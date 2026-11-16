import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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
  boats: "membership",
  titles: "membership",
  import: "membership",
  send: "comms",
  emails: "comms",
  log: "comms",
  contacts: "comms",
  memberships: "finance",
  transactions: "finance",
  categories: "finance",
  budget: "finance",
  actual: "finance",
} as const;
// adminOnly: pages that only make changes, so finance logins (who can look but not change) don't see them.
const LINKS: { key: keyof typeof SECTIONS; href: string; label: string; adminOnly?: boolean }[] = [
  { key: "members", href: "/admin/members", label: "Members" },
  { key: "applications", href: "/admin/applications", label: "Applications" },
  { key: "types", href: "/admin/types", label: "Membership types" },
  { key: "boats", href: "/admin/boats", label: "Boats" },
  { key: "titles", href: "/admin/titles", label: "Club titles" },
  { key: "import", href: "/admin/import", label: "Import", adminOnly: true },
  { key: "send", href: "/admin/emails/send", label: "Send email", adminOnly: true },
  { key: "contacts", href: "/admin/contacts/new", label: "Add contact", adminOnly: true },
  { key: "emails", href: "/admin/emails", label: "Templates" },
  { key: "log", href: "/admin/emails/log", label: "Email log" },
  { key: "transactions", href: "/admin/transactions", label: "Transactions" },
  { key: "memberships", href: "/admin/memberships", label: "Income" },
  { key: "actual", href: "/admin/actual", label: "Actual" },
  { key: "budget", href: "/admin/budget", label: "Budget" },
  { key: "categories", href: "/admin/categories", label: "Categories" },
];
const SECTION_NAME = { membership: "Membership admin", comms: "Communications admin", finance: "Finance admin" };

// The three admin areas. The heading row links between them; the area you're in is the page heading.
// Admins and finance logins see all three: each can look at the other's areas without changing them.
const AREAS = [
  { key: "membership", label: "Membership", href: "/admin/members", financeHref: "/admin/members" },
  { key: "comms", label: "Communications", href: "/admin/emails/send", financeHref: "/admin/emails" },
  { key: "finance", label: "Finance", href: "/admin/transactions", financeHref: "/admin/transactions" },
] as const;

// heading: false on pages that have their own page title, so there's only one main heading.
export async function AdminNav({ current, heading = true }: { current: keyof typeof SECTIONS; heading?: boolean }) {
  const section = SECTIONS[current];
  const { data: isAdmin } = await (await createClient()).rpc("has_role", { r: "admin" });
  const areas = AREAS.map((a) => ({ ...a, href: isAdmin ? a.href : a.financeHref }));
  return (
    <div className="space-y-3 print:hidden">
      <nav aria-label="Admin areas" className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-2xl">
        {areas.map((a) => {
          const here = a.key === section;
          const link = (
            <Link
              href={a.href}
              aria-current={here ? "page" : undefined}
              className={here ? "font-semibold text-slate-900 hover:text-sky-900" : "text-slate-400 hover:text-sky-900"}
            >
              {a.label}
            </Link>
          );
          return here && heading ? (
            <h1 key={a.key} className="text-2xl">
              {link}
            </h1>
          ) : (
            <span key={a.key}>{link}</span>
          );
        })}
      </nav>
      <nav aria-label={SECTION_NAME[section]} className="flex flex-wrap gap-4 border-b border-slate-200 pb-2 text-sm">
        {LINKS.filter((l) => SECTIONS[l.key] === section && (isAdmin || !l.adminOnly)).map((l) => (
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
    </div>
  );
}

export const STATUS_LABEL: Record<string, string> = {
  active: "Paid",
  awaiting_payment: "Awaiting payment",
  pending_approval: "Awaiting approval",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
};
