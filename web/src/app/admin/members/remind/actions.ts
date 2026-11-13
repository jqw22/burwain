"use server";

import { redirect } from "next/navigation";
import { fillPlaceholders, textToHtml, textWithoutImages, withLogo } from "@/lib/email";
import { logoUrl } from "@/lib/email-images";
import { sendEmails, type OutgoingEmail } from "@/lib/mailer";
import { meWithRole } from "@/lib/me";
import { renewalYear, valuesFor, type Recipient, type Template } from "./render";

async function render(t: Template, r: Recipient, yearLabel: string, to: string, logo: string | null, prefix = ""): Promise<OutgoingEmail> {
  const values = await valuesFor(r, yearLabel);
  const text = fillPlaceholders(t.body, values);
  return { to, subject: prefix + fillPlaceholders(t.subject, values), text: textWithoutImages(text), html: withLogo(textToHtml(text), logo) };
}

// Back to the send screen, keeping the same members and template selected.
function back(form: FormData, query: string): never {
  const keep = new URLSearchParams();
  for (const id of form.getAll("p")) keep.append("p", String(id));
  if (form.get("template")) keep.set("template", String(form.get("template")));
  if (form.get("preview")) keep.set("preview", String(form.get("preview")));
  redirect(`/admin/members/remind?${keep}&${query}`);
}

// Everything a send needs, checked again on the server.
async function load(form: FormData) {
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed) back(form, "error=admin");
  const year = await renewalYear(supabase);
  if (!year) back(form, "error=closed");
  const { data: template } = await supabase
    .from("email_templates")
    .select("id, subject, body")
    .eq("purpose", "renewal_reminder")
    .eq("id", String(form.get("template") ?? ""))
    .maybeSingle();
  if (!template) back(form, "error=template");
  const chosen = new Set(form.getAll("p").map(String));
  const { data } = await supabase.rpc("renewal_reminder_recipients", { p_template_id: template.id });
  const recipients = ((data ?? []) as Recipient[]).filter((r) => chosen.has(r.person_id));
  return { supabase, personId, year, template: template as Template, recipients, logo: await logoUrl(supabase) };
}

export async function sendTest(form: FormData) {
  const { supabase, personId, year, template, recipients, logo } = await load(form);
  const { data: me } = await supabase.from("people").select("email").eq("id", personId).single();
  if (!me?.email) back(form, "error=noemail");
  const example = recipients.find((r) => r.person_id === String(form.get("preview"))) ?? recipients[0];
  if (!example) back(form, "error=nobody");
  const [result] = await sendEmails([await render(template, example, year.label, me.email, logo, "[Test] ")]);
  back(form, result.ok ? `saved=test&to=${encodeURIComponent(me.email)}` : `error=send&detail=${encodeURIComponent(result.error)}`);
}

export async function sendReminders(form: FormData) {
  const { supabase, personId, year, template, recipients, logo } = await load(form);
  const list = recipients.filter((r) => r.email);
  if (list.length === 0) back(form, "error=nobody");

  const { data: campaign, error } = await supabase
    .from("email_campaigns")
    .insert({
      subject: template.subject,
      body: template.body,
      purpose: "renewal_reminder",
      template_id: template.id,
      is_news: false,
      created_by: personId,
      recipient_count: list.length,
    })
    .select("id")
    .single();
  if (error || !campaign) back(form, "error=save");

  const results = await sendEmails(await Promise.all(list.map((r) => render(template, r, year.label, r.email!, logo))));
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
    form,
    failed
      ? `error=partial&sent=${sent}&total=${list.length}&detail=${encodeURIComponent(failed.ok ? "" : failed.error)}`
      : `saved=sent&sent=${sent}`,
  );
}
