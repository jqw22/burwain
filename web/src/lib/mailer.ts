import "server-only";

// Sends email through Resend (https://resend.com). Needs RESEND_API_KEY and EMAIL_FROM set in Netlify;
// EMAIL_REPLY_TO is optional. Without them, sending is switched off and the app says so.
export function emailSendingEnabled() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type OutgoingEmail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> };
export type SendResult = { ok: true } | { ok: false; error: string };

const BATCH = 100; // Resend's batch endpoint takes up to 100 emails per call.

// Sends each email separately addressed (no one sees other recipients). Returns one result per email, in order.
export async function sendEmails(emails: OutgoingEmail[]): Promise<SendResult[]> {
  if (!emailSendingEnabled()) return emails.map(() => ({ ok: false, error: "Email sending isn't set up yet" }));
  const results: SendResult[] = [];
  for (let i = 0; i < emails.length; i += BATCH) {
    const chunk = emails.slice(i, i + BATCH);
    let error: string | null = null;
    try {
      const res = await fetch(`${process.env.RESEND_API_URL ?? "https://api.resend.com"}/emails/batch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(
          chunk.map((e) => ({
            from: process.env.EMAIL_FROM,
            to: [e.to],
            subject: e.subject,
            text: e.text,
            html: e.html,
            ...(e.headers ? { headers: e.headers } : {}),
            ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
          })),
        ),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; name?: string };
        error =
          res.status === 429
            ? "The email service's sending limit was reached (100 a day on the free plan). Try the rest tomorrow."
            : body.message ?? `The email service said no (error ${res.status})`;
      }
    } catch {
      error = "Couldn't reach the email service";
    }
    results.push(...chunk.map((): SendResult => (error ? { ok: false, error } : { ok: true })));
    if (error) {
      // Don't keep trying once it fails: mark the rest as not sent.
      results.push(...emails.slice(i + BATCH).map((): SendResult => ({ ok: false, error: error! })));
      break;
    }
  }
  return results;
}
