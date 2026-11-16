// Placeholders admins can use in email templates. Each is filled in per member when an email is sent.
export const PLACEHOLDERS = [
  { key: "first_name", label: "Member's first name", example: "Sam" },
  { key: "last_name", label: "Member's last name", example: "Example" },
  { key: "membership_type", label: "Their current membership type", example: "Family" },
  { key: "renewal_year", label: "The year they're renewing for", example: "2027" },
  { key: "renewal_price", label: "What renewing will cost", example: "£255" },
  { key: "renewal_link", label: "Link to log in and renew", example: "https://burwain.netlify.app/profile#renew" },
  { key: "boats", label: "Boats they store now (class and sail number)", example: "Laser 123456, Topper 4321" },
  { key: "boat_count", label: "How many boats they store now", example: "2" },
  { key: "boat_storage_price", label: "Boat storage price per boat (members rate)", example: "£35" },
  { key: "boat_storage_total", label: "What storing the same boats again will cost", example: "£70" },
  { key: "renewal_total", label: "Renewal plus storing the same boats again", example: "£325" },
] as const;

// Placeholders for the confirmation emails sent automatically after a card payment.
export const CONFIRMATION_PLACEHOLDERS = [
  { key: "first_name", label: "Their first name", example: "Sam" },
  { key: "last_name", label: "Their last name", example: "Example" },
  { key: "membership_type", label: "The membership they paid for", example: "Family" },
  { key: "membership_dates", label: "The dates it runs for", example: "1 Jan 2027 to 31 Dec 2027" },
  { key: "amount_paid", label: "How much they paid (including boat storage)", example: "£290" },
  { key: "boats", label: "Boats they paid storage for (class and sail number)", example: "Laser 123456" },
  { key: "member_link", label: "Link to log in and see their membership", example: "https://burwain.netlify.app/profile" },
] as const;

export const PURPOSES = {
  renewal_reminder: "Renewal reminder",
  general: "General",
  join_confirmation: "Join confirmation (sent automatically)",
  payment_confirmation: "Payment confirmation (sent automatically)",
} as const;
export type Purpose = keyof typeof PURPOSES;

// Which placeholders a template can use, by what it's used for.
export function placeholdersFor(purpose: string) {
  return purpose === "join_confirmation" || purpose === "payment_confirmation" ? CONFIRMATION_PLACEHOLDERS : PLACEHOLDERS;
}

// What each kind of template is for, shown under "Used for".
export const PURPOSE_HINTS: Record<string, string> = {
  renewal_reminder: "Renewal reminders are sent from the Members list. You can have several, e.g. a first and a final reminder.",
  general: "General templates can be used as a starting point on Send email.",
  join_confirmation:
    "Sent automatically to someone who applies on the Join page, once their card payment goes through. If there are several, the one changed most recently is used. Delete it to stop sending.",
  payment_confirmation:
    "Sent automatically to a member who pays by card at checkout (renewals, boat storage). If there are several, the one changed most recently is used. Delete it to stop sending.",
};

const PATTERN = /\{([a-z_]+)\}/g;

// Replaces {placeholders} with values; unknown ones are left as they are.
export function fillPlaceholders(text: string, values: Record<string, string>) {
  return text.replace(PATTERN, (whole, key: string) => values[key] ?? whole);
}

// Placeholders in the text that the app doesn't know, e.g. a typo like {firstname}.
export function unknownPlaceholders(text: string, purpose = "renewal_reminder") {
  const known = new Set<string>(placeholdersFor(purpose).map((p) => p.key));
  return [...new Set([...text.matchAll(PATTERN)].map((m) => m[1]))].filter((k) => !known.has(k));
}

export function exampleValues(overrides: Partial<Record<string, string>> = {}) {
  return {
    ...Object.fromEntries([...CONFIRMATION_PLACEHOLDERS, ...PLACEHOLDERS].map((p) => [p.key, p.example])),
    ...overrides,
  } as Record<string, string>;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Group emails (Communications admin > Send email) only know who the person is, not their membership.
export const GROUP_PLACEHOLDERS = PLACEHOLDERS.filter((p) => p.key === "first_name" || p.key === "last_name");

export function unknownGroupPlaceholders(text: string) {
  const known = new Set<string>(GROUP_PLACEHOLDERS.map((p) => p.key));
  return [...new Set([...text.matchAll(PATTERN)].map((m) => m[1]))].filter((k) => !known.has(k));
}

// An image in an email is written in the text as [image: https://...] on its own line.
export const IMAGE_PATTERN = /\[image: (https?:\/\/[^\s\]]+)\]/g;
export const imageMarker = (url: string) => `[image: ${url}]`;

function linkify(escaped: string) {
  return escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (url) => `<a href="${url}">${url}</a>`).replace(/\n/g, "<br>");
}

const imgTag = (url: string) =>
  `<img src="${escapeHtml(url)}" alt="" style="display: block; max-width: 100%; height: auto; border: 0; margin: 0 auto">`;

// Plain text to simple HTML: paragraphs on blank lines, line breaks kept, web addresses made into links,
// and [image: ...] lines shown as pictures.
export function textToHtml(text: string) {
  const paragraphs = text.trim().split(/\n{2,}/).map((p) =>
    p
      .split(IMAGE_PATTERN)
      // split() with a capture group gives text, url, text, url, ...
      .map((part, i) => (i % 2 === 1 ? imgTag(part) : linkify(escapeHtml(part))))
      .join(""),
  );
  return `<div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #1e293b">${paragraphs
    .map((p) => `<p style="margin: 0 0 1em">${p}</p>`)
    .join("")}</div>`;
}

// The plain-text copy of an email leaves images out.
export function textWithoutImages(text: string) {
  return text.replace(IMAGE_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Centred with a table as well as CSS, because some email apps ignore CSS centring.
const logoTag = (url: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 0 0 24px"><tr><td align="center" style="text-align: center"><img src="${escapeHtml(url)}" alt="Burwain" width="100" style="display: block; margin: 0 auto; width: 100px; max-width: 100px; max-height: 60px; height: auto; border: 0; object-fit: contain"></td></tr></table>`;

// The club logo (if there is one) above an email's message.
export function withLogo(html: string, logoUrl: string | null | undefined) {
  return logoUrl ? `<div style="max-width: 640px; margin: 0 auto">${logoTag(logoUrl)}${html}</div>` : html;
}

// A group email: the club logo (if there is one) at the top, the message, then the unsubscribe footer.
export function groupEmailHtml(body: string, opts: { logoUrl?: string | null; unsubscribeUrl: string }) {
  const logo = opts.logoUrl ? logoTag(opts.logoUrl) : "";
  const footer = `<p style="margin: 32px 0 0; padding-top: 12px; border-top: 1px solid #e2e8f0; font-family: Arial, sans-serif; font-size: 12px; color: #64748b">You're getting this email because you're a member of Burwain or on the club's email list. <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color: #64748b">Unsubscribe from these emails</a>.</p>`;
  return `<div style="max-width: 640px; margin: 0 auto">${logo}${textToHtml(body)}${footer}</div>`;
}

export function groupEmailText(body: string, unsubscribeUrl: string) {
  return `${textWithoutImages(body)}\n\n--\nTo stop getting these emails, unsubscribe here: ${unsubscribeUrl}`;
}
