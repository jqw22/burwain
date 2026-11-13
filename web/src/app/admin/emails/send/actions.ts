"use server";

import { siteOrigin } from "@/app/admin/members/remind/render";
import { fillPlaceholders, groupEmailHtml, groupEmailText, unknownGroupPlaceholders } from "@/lib/email";
import { logoUrl } from "@/lib/email-images";
import { sendEmails, type OutgoingEmail } from "@/lib/mailer";
import { meWithRole } from "@/lib/me";

export type SendState = { ok: boolean; message: string; sentAt?: number } | null;

export type GroupRecipient = {
  person_id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: "current" | "future" | "lapsed" | "contact";
  unsubscribed_at: string | null;
};

// What every send needs, checked again on the server.
async function load(form: FormData) {
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed) return { error: "Only club admins can send group emails." } as const;
  const subject = String(form.get("subject") ?? "").trim();
  const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n").trim();
  if (!subject) return { error: "Please write a subject." } as const;
  if (!body) return { error: "Please write the message." } as const;
  const unknown = unknownGroupPlaceholders(`${subject} ${body}`);
  if (unknown.length > 0)
    return { error: `Group emails can only use {first_name} and {last_name}. Please remove ${unknown.map((k) => `{${k}}`).join(", ")}.` } as const;

  const chosen = new Set(form.getAll("p").map(String));
  const { data } = await supabase.rpc("group_email_recipients");
  const recipients = ((data ?? []) as GroupRecipient[]).filter((r) => chosen.has(r.person_id) && !r.unsubscribed_at);
  const [{ data: tokens }, logo, origin] = await Promise.all([
    supabase.from("people").select("id, unsubscribe_token").in("id", recipients.map((r) => r.person_id).concat(personId)),
    logoUrl(supabase),
    siteOrigin(),
  ]);
  const tokenOf = new Map(((tokens ?? []) as { id: string; unsubscribe_token: string }[]).map((t) => [t.id, t.unsubscribe_token]));
  const templateId = String(form.get("template") ?? "") || null;

  const render = (r: Pick<GroupRecipient, "first_name" | "last_name">, to: string, token: string | undefined, prefix = ""): OutgoingEmail => {
    const values = { first_name: r.first_name, last_name: r.last_name };
    const filled = fillPlaceholders(body, values);
    const unsubscribeUrl = `${origin}/unsubscribe?t=${token ?? ""}`;
    return {
      to,
      subject: prefix + fillPlaceholders(subject, values),
      text: groupEmailText(filled, unsubscribeUrl),
      html: groupEmailHtml(filled, { logoUrl: logo, unsubscribeUrl }),
      headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
    };
  };
  return { supabase, personId, subject, body, templateId, recipients, tokenOf, render };
}

export async function sendGroupTest(_prev: SendState, form: FormData): Promise<SendState> {
  const loaded = await load(form);
  if ("error" in loaded) return { ok: false, message: loaded.error! };
  const { supabase, personId, recipients, tokenOf, render } = loaded;
  const { data: me } = await supabase.from("people").select("first_name, last_name, email").eq("id", personId).single();
  if (!me?.email) return { ok: false, message: "Your own record has no email address, so we can't send you a test." };
  // Filled in with the details of the person being previewed (or your own if nobody is ticked).
  const example = recipients.find((r) => r.person_id === String(form.get("preview"))) ?? recipients[0] ?? me;
  const [result] = await sendEmails([render(example, me.email, tokenOf.get(personId), "[Test] ")]);
  return result.ok
    ? { ok: true, message: `Test email sent to ${me.email}. Check your inbox (and spam folder).`, sentAt: Date.now() }
    : { ok: false, message: `The test email wasn't sent: ${result.error}` };
}

export async function sendGroupEmail(_prev: SendState, form: FormData): Promise<SendState> {
  const loaded = await load(form);
  if ("error" in loaded) return { ok: false, message: loaded.error! };
  const { supabase, personId, subject, body, templateId, recipients, tokenOf, render } = loaded;

  // One email per address: people who share an address (e.g. a couple) get it once.
  const seen = new Set<string>();
  const list = recipients.filter((r) => {
    const key = r.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (list.length === 0) return { ok: false, message: "Please tick at least one person to send to." };

  const { data: campaign, error } = await supabase
    .from("email_campaigns")
    .insert({
      subject,
      body,
      purpose: "general",
      template_id: templateId,
      is_news: true,
      created_by: personId,
      recipient_count: list.length,
    })
    .select("id")
    .single();
  if (error || !campaign) return { ok: false, message: "We couldn't start sending. Nothing was sent. Please try again." };

  const results = await sendEmails(list.map((r) => render(r, r.email, tokenOf.get(r.person_id))));
  const now = new Date().toISOString();
  await supabase.from("email_recipients").insert(
    list.map((r, i) => {
      const res = results[i];
      return {
        campaign_id: campaign.id,
        person_id: r.person_id,
        email: r.email,
        status: res.ok ? "sent" : "failed",
        sent_at: res.ok ? now : null,
        error: res.ok ? null : res.error,
      };
    }),
  );
  const sent = results.filter((r) => r.ok).length;
  await supabase.from("email_campaigns").update({ sent_at: now, recipient_count: sent }).eq("id", campaign.id);
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) return { ok: false, message: `Sent ${sent} of ${list.length}. The rest weren't sent: ${failed.error}` };
  return { ok: true, message: `Sent your email to ${sent} ${sent === 1 ? "person" : "people"}.`, sentAt: Date.now() };
}
