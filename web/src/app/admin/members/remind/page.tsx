import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Notice, SaveButton } from "@/components/fields";
import { fillPlaceholders } from "@/lib/email";
import { emailSendingEnabled } from "@/lib/mailer";
import { meWithRole, pounds, ukDate } from "@/lib/me";
import { sendReminders, sendTest } from "./actions";
import { ConfirmSend } from "./confirm-send";
import { renewalYear, valuesFor, type Recipient } from "./render";

type Template = { id: string; name: string; subject: string; body: string };

const ERRORS: Record<string, string> = {
  admin: "Only club admins can send renewal reminders.",
  closed: "There are no membership types to renew onto yet.",
  template: "Please choose which reminder to send.",
  noemail: "Your own record has no email address, so we can't send you a test.",
  nobody: "None of the selected members can be sent this reminder.",
  save: "We couldn't start sending. Nothing was sent. Please try again.",
};

// Second step of sending renewal reminders: the members ticked on the Members list, which reminder to
// send, a preview, then confirm.
export default async function RemindPage({ searchParams }: PageProps<"/admin/members/remind">) {
  const params = await searchParams;
  const p = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const ids = [params.p ?? []].flat().map(String);
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const [year, { data: templateData }] = await Promise.all([
    renewalYear(supabase),
    supabase.from("email_templates").select("id, name, subject, body").eq("purpose", "renewal_reminder").order("name"),
  ]);
  const templates = (templateData ?? []) as Template[];
  const template = templates.find((t) => t.id === p("template")) ?? (templates.length === 1 ? templates[0] : undefined);
  const { data } = await supabase.rpc("renewal_reminder_recipients", template ? { p_template_id: template.id } : {});
  const due = (data ?? []) as Recipient[];
  const chosen = due.filter((r) => ids.includes(r.person_id));
  const leftOut = ids.length - chosen.length;
  const sendable = chosen.filter((r) => r.email);
  const preview = sendable.find((r) => r.person_id === p("preview")) ?? sendable[0];
  const values = preview && year ? await valuesFor(preview, year.label) : null;
  const enabled = emailSendingEnabled();

  // Links and hidden fields that keep the selected members.
  const keep = (change: Record<string, string>) => {
    const q = new URLSearchParams();
    ids.forEach((id) => q.append("p", id));
    if (template) q.set("template", template.id);
    for (const [k, v] of Object.entries(change)) q.set(k, v);
    return `/admin/members/remind?${q}`;
  };
  const hidden = (
    <>
      {ids.map((id) => (
        <input key={id} type="hidden" name="p" value={id} />
      ))}
      {template && <input type="hidden" name="template" value={template.id} />}
      {preview && <input type="hidden" name="preview" value={preview.person_id} />}
    </>
  );

  const saved =
    p("saved") === "sent"
      ? `Sent ${p("sent")} renewal ${p("sent") === "1" ? "reminder" : "reminders"}.`
      : p("saved") === "test"
        ? `Test email sent to ${p("to")}. Check your inbox (and spam folder).`
        : undefined;
  const error =
    p("error") === "partial"
      ? `Sent ${p("sent")} of ${p("total")}. The rest weren't sent: ${p("detail")}`
      : p("error") === "send"
        ? `The test email wasn't sent: ${p("detail")}`
        : ERRORS[p("error")];

  return (
    <div className="space-y-6">
      <AdminNav current="members" heading={false} />
      <h1 className="text-2xl font-semibold">Send renewal reminders</h1>
      <p>
        <Link href="/admin/members?renewal=outstanding" className="text-sm text-sky-800 underline">
          ← Back to Members
        </Link>
      </p>
      <Notice message={saved} />
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}

      {ids.length === 0 ? (
        <Card title="Nobody selected">
          <p className="text-slate-700">Tick the members to remind on the Members list, then press Send reminder.</p>
        </Card>
      ) : !year ? (
        <Card title="Not open yet">
          <p className="text-slate-700">There are no membership types to renew onto yet.</p>
        </Card>
      ) : templates.length === 0 ? (
        <Card title="No reminder templates">
          <p className="text-slate-700">
            Please <Link href="/admin/emails?edit=new#edit" className="text-sky-800 underline">add an email template</Link> used for renewal reminders.
          </p>
        </Card>
      ) : (
        <>
          <Card title="1. Choose the reminder">
            <form className="flex flex-wrap items-end gap-3">
              {ids.map((id) => (
                <input key={id} type="hidden" name="p" value={id} />
              ))}
              <label className="block">
                <span className="text-sm font-medium">Reminder</span>
                <select name="template" defaultValue={template?.id ?? ""} required className="mt-1 block rounded border border-slate-300 bg-white px-3 py-2">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <SaveButton variant="secondary" pendingText="Loading…">
                Use this reminder
              </SaveButton>
            </form>
          </Card>

          <Card title={`2. Members selected (${chosen.length})`}>
            {leftOut > 0 && (
              <p className="mb-3 rounded border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">
                {leftOut} selected {leftOut === 1 ? "person is" : "people are"} left out because they no longer have a renewal outstanding.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-600">
                  <tr>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Renewing</th>
                    <th className="py-2 pr-4">Price</th>
                    <th className="py-2 pr-4">{template ? `Sent "${template.name}"` : "Last reminded"}</th>
                    <th className="py-2"><span className="sr-only">Preview</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {chosen.map((r) => {
                    const name = `${r.first_name} ${r.last_name}`;
                    return (
                      <tr key={r.person_id} aria-label={name} className={r.person_id === preview?.person_id ? "bg-sky-50" : undefined}>
                        <td className="py-2 pr-4 font-medium">{name}</td>
                        <td className="py-2 pr-4">
                          {r.email ?? (
                            <Link href={`/admin/members/${r.person_id}`} className="rounded bg-red-50 px-2 py-0.5 text-red-800 underline">
                              No email address: please add one
                            </Link>
                          )}
                        </td>
                        <td className="py-2 pr-4">{r.membership_types}</td>
                        <td className="py-2 pr-4">{pounds(r.renewal_price_pence)}</td>
                        <td className="py-2 pr-4">
                          {r.last_reminded_at ? (
                            <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-900">Already sent {ukDate(r.last_reminded_at)}</span>
                          ) : (
                            <span className="text-slate-500">Not yet</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          {template && r.email && (
                            <Link href={keep({ preview: r.person_id }) + "#preview"} className="text-sky-800 underline" aria-label={`Preview email for ${name}`}>
                              Preview
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {chosen.length > sendable.length && (
              <p className="mt-3 text-sm text-red-800">
                {chosen.length - sendable.length} selected {chosen.length - sendable.length === 1 ? "member has" : "members have"} no email address and
                won&apos;t be sent anything.
              </p>
            )}
          </Card>

          {template && preview && values && (
            <Card title={`3. Preview: ${preview.first_name} ${preview.last_name}`} id="preview">
              <div className="rounded border border-slate-200 bg-white p-4">
                <p className="border-b border-slate-100 pb-2 text-sm">
                  <span className="text-slate-500">To: </span>
                  {preview.email}
                  <br />
                  <span className="text-slate-500">Subject: </span>
                  <strong>{fillPlaceholders(template.subject, values)}</strong>
                </p>
                <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{fillPlaceholders(template.body, values)}</div>
              </div>
              {enabled && (
                <form action={sendTest} className="mt-4">
                  {hidden}
                  <SaveButton variant="secondary" pendingText="Sending test…">
                    Send this as a test to me
                  </SaveButton>
                </form>
              )}
            </Card>
          )}

          {template && (
            <Card title="4. Send">
              {!enabled ? (
                <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Sending isn&apos;t switched on yet. It starts working once the club&apos;s email service (Resend) is set up.
                </p>
              ) : (
                <form action={sendReminders} aria-label="Send renewal reminders">
                  {hidden}
                  <ConfirmSend count={sendable.length} />
                </form>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
