"use server";

import { redirect } from "next/navigation";
import { fillPlaceholders, textToHtml } from "@/lib/email";
import { sendEmails, type OutgoingEmail } from "@/lib/mailer";
import { meWithRole } from "@/lib/me";
import { valuesFor, type Recipient, type Template } from "./render";

async function render(t: Template, r: Recipient, yearLabel: string, to: string, prefix = ""): Promise<OutgoingEmail> {
  const values = await valuesFor(r, yearLabel);
  const text = fillPlaceholders(t.body, values);
  return { to, subject: prefix + fillPlaceholders(t.subject, values), text, html: textToHtml(text) };
}

function back(query: string): never {
  redirect(`/admin/reminders?${query}`);
}

// Everything a send needs, checked again on the server.
async function load() {
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed) back("error=admin");
  const { data: years } = await supabase.rpc("open_club_years");
  const year = ((years ?? []) as { id: string; label: string; is_renewal: boolean }[]).find((y) => y.is_renewal);
  if (!year) back("error=closed");
  const { data: template } = await supabase
    .from("email_templates")
    .select("id, subject, body")
    .eq("purpose", "renewal_reminder")
    .maybeSingle();
  if (!template) back("error=template");
  const { data } = await supabase.rpc("renewal_reminder_recipients", { p_club_year_id: year.id });
  return { supabase, personId, year, template: template as Template, recipients: (data ?? []) as Recipient[] };
}

export async function sendTest(form: FormData) {
  const { supabase, personId, year, template, recipients } = await load();
  const { data: me } = await supabase.from("people").select("email").eq("id", personId).single();
  if (!me?.email) back("error=noemail");
  const example = recipients.find((r) => r.person_id === String(form.get("preview"))) ?? recipients[0];
  if (!example) back("error=nobody");
  const [result] = await sendEmails([await render(template, example, year.label, me.email, "[Test] ")]);
  back(result.ok ? `saved=test&to=${encodeURIComponent(me.email)}` : `error=send&detail=${encodeURIComponent(result.error)}`);
}

export async function sendReminders(form: FormData) {
  const { supabase, personId, year, template, recipients } = await load();
  const chosen = new Set(form.getAll("person").map(String));
  const list = recipients.filter((r) => chosen.has(r.person_id) && r.email);
  if (list.length === 0) back("error=choose");

  const { data: campaign, error } = await supabase
    .from("email_campaigns")
    .insert({
      subject: template.subject,
      body: template.body,
      purpose: "renewal_reminder",
      template_id: template.id,
      club_year_id: year.id,
      is_news: false,
      created_by: personId,
      recipient_count: list.length,
    })
    .select("id")
    .single();
  if (error || !campaign) back("error=save");

  const results = await sendEmails(await Promise.all(list.map((r) => render(template, r, year.label, r.email!))));
  const now = new Date().toISOString();
  await supabase.from("email_recipients").insert(
    list.map((r, i) => {
      const res = results[i];
      return {
        campaign_id: campaign.id,
        person_id: r.person_id,
        email: r.email!,
        status: res.ok ? "sent" : "failed",
        sent_at: res.ok ? now : null,
        error: res.ok ? null : res.error,
      };
    }),
  );
  const sent = results.filter((r) => r.ok).length;
  await supabase.from("email_campaigns").update({ sent_at: now, recipient_count: sent }).eq("id", campaign.id);
  const failed = results.find((r) => !r.ok);
  back(
    failed
      ? `error=partial&sent=${sent}&total=${list.length}&detail=${encodeURIComponent(failed.ok ? "" : failed.error)}`
      : `saved=sent&sent=${sent}`,
  );
}
