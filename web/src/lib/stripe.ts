import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

// Card payments through Stripe Checkout (Stripe's own secure payment page). The app never sees card
// details. Talks to Stripe's API directly, so there's no extra package to keep up to date.
//
// Netlify environment variables (server-only, never NEXT_PUBLIC_):
//   STRIPE_SECRET_KEY      sk_test_... (test mode) or sk_live_...
//   STRIPE_WEBHOOK_SECRET  whsec_...   from Stripe > Developers > Webhooks
//   SUPABASE_SECRET_KEY    sb_secret_... from Supabase > Project Settings > API Keys
// Until STRIPE_SECRET_KEY and SUPABASE_SECRET_KEY are both set, the test checkout is used instead.

const API = process.env.STRIPE_API_URL ?? "https://api.stripe.com";

export function cardPaymentsOn(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.SUPABASE_SECRET_KEY);
}

export type CheckoutSession = {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  payment_intent: string | null;
  metadata: Record<string, string> | null;
};

async function stripe<T>(path: string, body?: URLSearchParams): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${json?.error?.message ?? res.status}`);
  return json as T;
}

// The address of this site, for the pages Stripe sends people back to.
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
  return process.env.URL ?? "http://localhost:3000";
}

// What's paid for is either a member receipt (renewals, boats) or a Join application.
export type PaymentFor = { kind: "receipt"; id: string } | { kind: "application"; id: string };

export async function createCheckout(opts: {
  for: PaymentFor;
  amountPence: number;
  description: string;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  const p = new URLSearchParams({
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "gbp",
    "line_items[0][price_data][unit_amount]": String(opts.amountPence),
    "line_items[0][price_data][product_data][name]": opts.description,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    client_reference_id: opts.for.id,
    "metadata[kind]": opts.for.kind,
    "metadata[id]": opts.for.id,
    "payment_intent_data[description]": opts.description,
    "payment_intent_data[metadata][kind]": opts.for.kind,
    "payment_intent_data[metadata][id]": opts.for.id,
  });
  if (opts.email) p.set("customer_email", opts.email);
  return stripe<CheckoutSession>("/v1/checkout/sessions", p);
}

export function getCheckout(id: string): Promise<CheckoutSession> {
  return stripe<CheckoutSession>(`/v1/checkout/sessions/${encodeURIComponent(id)}`);
}

// Records a paid Stripe Checkout in the database. Safe to run more than once (the webhook and the
// page Stripe sends people back to both do it). Returns what was paid for, or null if not paid yet.
export async function recordCheckout(session: CheckoutSession): Promise<PaymentFor | null> {
  const kind = session.metadata?.kind;
  const id = session.metadata?.id;
  if (!id || (kind !== "receipt" && kind !== "application")) return null;
  if (session.payment_status !== "paid") return null;
  const admin = createAdminClient();
  const args = { p_ref: session.payment_intent ?? session.id, p_amount: session.amount_total ?? 0 };
  const { error } =
    kind === "receipt"
      ? await admin.rpc("confirm_card_receipt", { p_receipt: id, ...args })
      : await admin.rpc("confirm_application_card", { p_id: id, ...args });
  if (error) throw new Error(error.message);
  return { kind, id };
}

// Stripe signs each webhook with the signing secret. Returns the event, or null if the signature
// is wrong or more than 5 minutes old.
export function verifyWebhook(payload: string, signature: string | null): { type: string; data: { object: CheckoutSession } } | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return null;
  const parts = signature.split(",").map((kv) => kv.split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  const ok = sigs.some((s) => {
    const given = Buffer.from(s, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return ok ? JSON.parse(payload) : null;
}
