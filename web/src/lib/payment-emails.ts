import "server-only";
import { fillPlaceholders, textToHtml, textWithoutImages, withLogo } from "@/lib/email";
import { logoUrl } from "@/lib/email-images";
import { emailSendingEnabled, sendEmails } from "@/lib/mailer";
import { pounds } from "@/lib/me";
import { typeDates } from "@/lib/quote";
import { siteOrigin } from "@/app/admin/members/remind/render";
import { createAdminClient } from "@/lib/supabase/admin";

type Details = {
  person_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  membership_type: string | null;
  starts_on: string | null;
  ends_on: string | null;
  amount_pence: number;
  boats: string | null;
};

// After a card payment is newly recorded: the confirmation email from the club's template, if there
// is one (Join confirmation for the Join form, Payment confirmation for checkout). Emails to members
// are kept in the Email log. Never stops the payment being recorded: problems are only logged.
export async function sendCardPaymentEmail(kind: "receipt" | "application", id: string) {
  if (!emailSendingEnabled()) return;
  const purpose = kind === "application" ? "join_confirmation" : "payment_confirmation";
  const admin = createAdminClient();
  const [{ data: template }, { data: details }] = await Promise.all([
    admin
      .from("email_templates")
      .select("id, subject, body")
      .eq("purpose", purpose)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; subject: string; body: string }>(),
    admin.rpc("card_payment_email", { p_kind: kind, p_id: id }).maybeSingle<Details>(),
  ]);
  if (!template || !details?.email) return;

  const values: Record<string, string> = {
    first_name: details.first_name ?? "",
    last_name: details.last_name ?? "",
    membership_type: details.membership_type ?? "boat storage",
    membership_dates: details.starts_on && details.ends_on ? typeDates({ starts_on: details.starts_on, ends_on: details.ends_on }) : "",
    amount_paid: pounds(details.amount_pence),
    boats: details.boats ?? "none",
    member_link: `${await siteOrigin()}/profile`,
  };
  const text = fillPlaceholders(template.body, values);
  const logo = await logoUrl(admin as unknown as Parameters<typeof logoUrl>[0]);
  const [result] = await sendEmails([
    { to: details.email, subject: fillPlaceholders(template.subject, values), text: textWithoutImages(text), html: withLogo(textToHtml(text), logo) },
  ]);
  if (!result.ok) console.error("Confirmation email", kind, id, result.error);

  // The Email log lists emails by member, so only checkout confirmations (to existing members) go in it.
  if (details.person_id) {
    const now = new Date().toISOString();
    const { data: campaign } = await admin
      .from("email_campaigns")
      .insert({
        subject: fillPlaceholders(template.subject, values),
        body: text,
        purpose,
        template_id: template.id,
        is_news: false,
        recipient_count: result.ok ? 1 : 0,
        sent_at: now,
      })
      .select("id")
      .single();
    if (campaign) {
      await admin.from("email_recipients").insert({
        campaign_id: campaign.id,
        person_id: details.person_id,
        email: details.email,
        status: result.ok ? "sent" : "failed",
        sent_at: result.ok ? now : null,
        error: result.ok ? null : result.error,
      });
    }
  }
}
