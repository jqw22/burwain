import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Notice, SaveButton } from "@/components/fields";
import { fillPlaceholders } from "@/lib/email";
import { emailSendingEnabled } from "@/lib/mailer";
import { meWithRole, pounds, ukDate } from "@/lib/me";
import { sendTest } from "./actions";
import { renewalYear, valuesFor, type Recipient } from "./render";
import { SendForm } from "./send-form";

type Campaign = { id: string; sent_at: string | null; recipient_count: number | null; people: { first_name: string; last_name: string } | null };

const ERRORS: Record<string, string> = {
  admin: "Only club admins can send renewal reminders.",
  closed: "There are no membership types to renew onto yet.",
  template: "There's no renewal reminder template. Add one on the Email templates page.",
  noemail: "Your own record has no email address, so we can't send you a test.",
  nobody: "There's nobody to remind, so there's nothing to test with.",
  choose: "Please tick at least one member to send to.",
  save: "We couldn't start sending. Nothing was sent. Please try again.",
};

export default async function RemindersPage({ searchParams }: PageProps<"/admin/reminders">) {
  const params = await searchParams;
  const p = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const year = await renewalYear(supabase);
  const { data: template } = await supabase
    .from("email_templates")
    .select("id, name, subject, body")
    .eq("purpose", "renewal_reminder")
    .maybeSingle();

  const { data: recipientData } = year ? await supabase.rpc("renewal_reminder_recipients") : { data: [] };
  const all = (recipientData ?? []) as Recipient[];
  const withEmail = all.filter((r) => r.email);
  const noEmail = all.filter((r) => !r.email);
  const preview = withEmail.find((r) => r.person_id === p("preview")) ?? withEmail[0];
  const values = preview && year ? await valuesFor(preview, year.label) : null;

  const { data: campaignData } = year
    ? await supabase
        .from("email_campaigns")
        .select("id, sent_at, recipient_count, people!email_campaigns_created_by_fkey(first_name, last_name)")
        .eq("purpose", "renewal_reminder")
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [] };
  const campaigns = (campaignData ?? []) as unknown as Campaign[];

  const enabled = emailSendingEnabled();
  const saved =
    p("saved") === "sent"
      ? `Sent ${p("sent")} renewal ${p("sent") === "1" ? "reminder" : "reminders"}.`
      : p("saved") === "test"
        ? `Test email sent to ${p("to")}. Check your inbox (and spam folder).`
        : undefined;
  const error =
    p("error") === "partial"
      ? `Sent ${p("sent")} of ${p("total")}. The rest weren't sent: ${p("detail")} They're still ticked below, so you can send them later.`
      : p("error") === "send"
        ? `The test email wasn't sent: ${p("detail")}`
        : ERRORS[p("error")];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Communications</h1>
      <AdminNav current="reminders" />
      <Notice message={saved} />
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}

      {!year ? (
        <Card title="Not open yet">
          <p className="text-slate-700">Renewal reminders can be sent once next year&apos;s membership types are set up (an active type starting after today). They go to members whose membership ends within 60 days.</p>
        </Card>
      ) : !template ? (
        <Card title="No reminder template">
          <p className="text-slate-700">
            Please <Link href="/admin/emails?edit=new#edit" className="text-sky-800 underline">add an email template</Link> and set it to be used for renewal reminders.
          </p>
        </Card>
      ) : (
        <>
          <Card title={`Who still needs to renew for ${year.label} (${withEmail.length})`}>
            <p className="mb-3 text-sm text-slate-600">
              One email per family, to the main contact. People who&apos;ve already been reminded aren&apos;t ticked, so they don&apos;t get it twice. The
              email is <Link href={`/admin/emails?edit=${template.id}#edit`} className="text-sky-800 underline">{template.name}</Link>.
            </p>
            {withEmail.length === 0 ? (
              <p className="text-slate-700">Everyone with an email address has renewed. 🎉</p>
            ) : (
              <SendForm
                key={campaigns[0]?.id ?? "none"}
                recipients={withEmail.map((r) => ({
                  ...r,
                  price: pounds(r.renewal_price_pence),
                  reminded: r.last_reminded_at ? ukDate(r.last_reminded_at) : null,
                }))}
                enabled={enabled}
                preview={preview?.person_id ?? ""}
              />
            )}
            {noEmail.length > 0 && (
              <div className="mt-4 rounded border border-slate-200 p-3 text-sm">
                <p className="font-medium">No email address ({noEmail.length}), so please contact them another way:</p>
                <ul className="mt-1 list-disc pl-5 text-slate-700">
                  {noEmail.map((r) => (
                    <li key={r.person_id}>
                      <Link href={`/admin/members/${r.person_id}`} className="underline">{r.first_name} {r.last_name}</Link>: {r.membership_types}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {preview && values && (
            <Card title={`Preview: ${preview.first_name} ${preview.last_name}`} id="preview">
              <div className="rounded border border-slate-200 bg-white p-4">
                <p className="border-b border-slate-100 pb-2 text-sm">
                  <span className="text-slate-500">To: </span>{preview.email}
                  <br />
                  <span className="text-slate-500">Subject: </span>
                  <strong>{fillPlaceholders(template.subject, values)}</strong>
                </p>
                <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{fillPlaceholders(template.body, values)}</div>
              </div>
              {enabled && (
                <form action={sendTest} className="mt-4">
                  <input type="hidden" name="preview" value={preview.person_id} />
                  <SaveButton variant="secondary" pendingText="Sending test…">Send this as a test to me</SaveButton>
                </form>
              )}
            </Card>
          )}

          <Card title="Sent so far">
            {campaigns.length === 0 ? (
              <p className="text-slate-700">No renewal reminders sent yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {campaigns.map((c) => (
                  <li key={c.id} className="py-2">
                    {c.sent_at ? ukDate(c.sent_at) : "Not finished"}: {c.recipient_count ?? 0} sent
                    {c.people && <span className="text-slate-600"> by {c.people.first_name} {c.people.last_name}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
