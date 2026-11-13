import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card } from "@/components/fields";
import { meWithRole } from "@/lib/me";
import { PURPOSE_LABEL, sentWhen } from "./format";

type Campaign = {
  id: string;
  subject: string;
  purpose: string;
  sent_at: string | null;
  created_at: string;
  sender: { first_name: string; last_name: string } | null;
  email_recipients: { status: string }[];
};

// Communications admin > Email log: every group email and renewal reminder sent, newest first.
export default async function EmailLogPage() {
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const { data } = await supabase
    .from("email_campaigns")
    .select("id, subject, purpose, sent_at, created_at, sender:people!email_campaigns_created_by_fkey(first_name, last_name), email_recipients(status)")
    .order("created_at", { ascending: false })
    .limit(500);
  const campaigns = (data ?? []) as unknown as Campaign[];

  return (
    <div className="space-y-6">
      <AdminNav current="log" />
      <Card title="Email log">
        <p className="mb-3 text-sm text-slate-600">Every group email and renewal reminder sent from the app, newest first. Click one to see the message and who got it.</p>
        {campaigns.length === 0 ? (
          <p className="text-slate-700">No emails sent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="py-2 pr-4">Sent</th>
                  <th className="py-2 pr-4">Subject</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Sent by</th>
                  <th className="py-2 pr-4 text-right">Sent to</th>
                  <th className="py-2 text-right">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((c) => {
                  const sent = c.email_recipients.filter((r) => r.status === "sent").length;
                  const failed = c.email_recipients.filter((r) => r.status === "failed").length;
                  return (
                    <tr key={c.id} aria-label={c.subject}>
                      <td className="whitespace-nowrap py-2 pr-4">{sentWhen(c.sent_at ?? c.created_at)}</td>
                      <td className="py-2 pr-4">
                        <Link href={`/admin/emails/log/${c.id}`} className="font-medium text-sky-800 underline">
                          {c.subject}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">{PURPOSE_LABEL[c.purpose] ?? c.purpose}</td>
                      <td className="py-2 pr-4">{c.sender ? `${c.sender.first_name} ${c.sender.last_name}` : ""}</td>
                      <td className="py-2 pr-4 text-right">{sent}</td>
                      <td className="py-2 text-right">{failed > 0 ? <span className="rounded bg-red-50 px-2 py-0.5 text-red-800">{failed}</span> : 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
