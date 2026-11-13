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

// The three admin areas. The heading row links between them; the area you're in is the page heading.
const AREAS = [
  { key: "membership", label: "Membership", href: "/admin/members", adminOnly: true },
  { key: "comms", label: "Communications", href: "/admin/emails", adminOnly: true },
  { key: "finance", label: "Finance", href: "/admin/memberships", adminOnly: false },
] as const;

// heading: false on pages that have their own page title, so there's only one main heading.
export async function AdminNav({ current, heading = true }: { current: keyof typeof SECTIONS; heading?: boolean }) {
  const section = SECTIONS[current];
  // Finance users who aren't admins only see the Finance area.
  const { data: isAdmin } = await (await createClient()).rpc("has_role", { r: "admin" });
  const areas = AREAS.filter((a) => isAdmin || !a.adminOnly);
  return (
    <div className="space-y-3">
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
