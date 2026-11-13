import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card } from "@/components/fields";
import { textToHtml } from "@/lib/email";
import { meWithRole } from "@/lib/me";
import { PURPOSE_LABEL, sentWhen } from "../format";

type Campaign = {
  id: string;
  subject: string;
  body: string;
  purpose: string;
  sent_at: string | null;
  created_at: string;
  sender: { first_name: string; last_name: string } | null;
};
type Recipient = {
  person_id: string;
  email: string;
  status: string;
  sent_at: string | null;
  error: string | null;
  people: { first_name: string; last_name: string } | null;
};

// One email from the log: the message as written (placeholders such as {first_name} are filled in per
// person when sent) and everyone it went to.
export default async function EmailLogEntryPage({ params }: PageProps<"/admin/emails/log/[id]">) {
  const { id } = await params;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const [{ data: c }, { data: rs }] = await Promise.all([
    supabase
      .from("email_campaigns")
      .select("id, subject, body, purpose, sent_at, created_at, sender:people!email_campaigns_created_by_fkey(first_name, last_name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("email_recipients").select("person_id, email, status, sent_at, error, people(first_name, last_name)").eq("campaign_id", id),
  ]);
  const campaign = c as unknown as Campaign | null;
  const recipients = ((rs ?? []) as unknown as Recipient[]).sort((a, b) =>
    `${a.people?.last_name} ${a.people?.first_name}`.localeCompare(`${b.people?.last_name} ${b.people?.first_name}`),
  );

  return (
    <div className="space-y-6">
      <AdminNav current="log" />
      <p>
        <Link href="/admin/emails/log" className="text-sm text-sky-800 underline">
          ← Back to Email log
        </Link>
      </p>
      {!campaign ? (
        <Card title="Not found">
          <p className="text-slate-700">That email isn&apos;t in the log.</p>
        </Card>
      ) : (
        <>
          <Card title={campaign.subject}>
            <p className="mb-3 text-sm text-slate-600">
              {PURPOSE_LABEL[campaign.purpose] ?? campaign.purpose}, sent {sentWhen(campaign.sent_at ?? campaign.created_at)}
              {campaign.sender ? ` by ${campaign.sender.first_name} ${campaign.sender.last_name}` : ""}.
            </p>
            {/* Built from escaped text by textToHtml, so it's safe to show as HTML. */}
            <div className="break-words rounded border border-slate-200 bg-white p-4" dangerouslySetInnerHTML={{ __html: textToHtml(campaign.body) }} />
          </Card>
          <Card title={`Sent to (${recipients.filter((r) => r.status === "sent").length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-slate-600">
                  <tr>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recipients.map((r) => {
                    const name = r.people ? `${r.people.first_name} ${r.people.last_name}` : "(removed)";
                    return (
                      <tr key={r.person_id} aria-label={name}>
                        <td className="py-2 pr-4">
                          <Link href={`/admin/members/${r.person_id}`} className="text-sky-800 underline">
                            {name}
                          </Link>
                        </td>
                        <td className="py-2 pr-4">{r.email}</td>
                        <td className="py-2">
                          {r.status === "sent" ? (
                            <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-900">Sent</span>
                          ) : (
                            <span className="rounded bg-red-50 px-2 py-0.5 text-red-800">Not sent{r.error ? `: ${r.error}` : ""}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
