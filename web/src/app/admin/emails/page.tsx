import Link from "next/link";
import { headers } from "next/headers";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Notice } from "@/components/fields";
import { PURPOSES, exampleValues, type Purpose } from "@/lib/email";
import { meWithRole, ukDate } from "@/lib/me";
import { TemplateForm } from "./template-form";

type Template = { id: string; name: string; purpose: Purpose; subject: string; body: string; updated_at: string };

const SAVED: Record<string, string> = {
  added: "Email template added.",
  updated: "Email template saved.",
};
const ERRORS: Record<string, string> = {
  admin: "Only club admins can change email templates.",
  name: "Please give the template a name.",
  subject: "Please write a subject.",
  body: "Please write the message.",
  placeholder: "Some placeholders weren't recognised. Check the spelling against the list of placeholders.",
  duplicate: "Another template already has that name. Please choose a different one.",
  renewal: "Another template is already the renewal reminder. Change that one to General first, or edit it instead.",
  save: "We couldn't save that. Please try again.",
};

export default async function EmailTemplatesPage({ searchParams }: PageProps<"/admin/emails">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const [{ data }, { data: yearsData }] = await Promise.all([
    supabase.from("email_templates").select("id, name, purpose, subject, body, updated_at").order("name"),
    supabase.rpc("open_club_years"),
  ]);
  const templates = (data ?? []) as Template[];
  const years = (yearsData ?? []) as { label: string; is_renewal: boolean }[];
  const h = await headers();
  const host = h.get("host");
  const examples = exampleValues({
    renewal_year: years.find((y) => y.is_renewal)?.label ?? String(new Date().getFullYear() + 1),
    ...(host ? { renewal_link: `${host.startsWith("localhost") ? "http" : "https"}://${host}/profile#renew` } : {}),
  });

  const edit = typeof params.edit === "string" ? params.edit : "";
  const editing = templates.find((t) => t.id === edit) ?? null;
  const saved = typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Email templates</h1>
      <AdminNav current="emails" />
      <Notice message={saved} />
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}

      {edit && (
        <Card title={editing ? `Edit ${editing.name}` : "Add an email template"} id="edit">
          <TemplateForm key={editing?.id ?? "new"} template={editing} examples={examples} />
        </Card>
      )}

      <Card
        title="Templates"
        action={
          !edit && (
            <Link href="/admin/emails?edit=new#edit" className="rounded bg-sky-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-950">
              Add an email template
            </Link>
          )
        }
      >
        <p className="mb-2 text-sm text-slate-600">
          Write the emails the club sends. Sending isn&apos;t switched on yet: it comes once the club&apos;s own email address is connected.
        </p>
        {templates.length === 0 ? (
          <p className="text-slate-700">No templates yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="py-2 pr-4">Template</th>
                  <th className="py-2 pr-4">Used for</th>
                  <th className="py-2 pr-4">Subject</th>
                  <th className="py-2 pr-4">Last changed</th>
                  <th className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {templates.map((t) => (
                  <tr key={t.id} aria-label={t.name}>
                    <td className="py-2 pr-4 font-medium">{t.name}</td>
                    <td className="py-2 pr-4">{PURPOSES[t.purpose] ?? t.purpose}</td>
                    <td className="py-2 pr-4">{t.subject}</td>
                    <td className="py-2 pr-4 text-slate-600">{ukDate(t.updated_at)}</td>
                    <td className="py-2 text-right">
                      <Link href={`/admin/emails?edit=${t.id}#edit`} className="text-sky-800 underline" aria-label={`Edit ${t.name}`}>
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
