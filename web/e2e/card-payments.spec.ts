import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";

// Card payments with Stripe, against a pretend Stripe (below) and a second copy of the app on port
// 3101 that has the Stripe settings (playwright.config.ts). Needs the local Supabase stack.
const DB_URL = process.env.E2E_DB_URL;
const MAILPIT_URL = process.env.E2E_MAILPIT_URL;
const APP = "http://localhost:3101";
const WEBHOOK_SECRET = "whsec_e2e";

test.skip(!DB_URL || !MAILPIT_URL || !process.env.E2E_SUPABASE_SECRET_KEY, "needs a local Supabase stack and its secret key");
test.describe.configure({ mode: "serial" });
test.use({ baseURL: APP });

const run = Date.now().toString(36);
const memberEmail = `card-${run}@example.test`;

function sql(statement: string) {
  return execFileSync("psql", [DB_URL!, "-v", "ON_ERROR_STOP=1", "-qtAc", statement], { encoding: "utf8" }).trim();
}

// Pretend Stripe: makes Checkout Sessions, and a payment page with Pay and Cancel links, where Pay
// marks the session paid and goes to the success address (as Stripe does after a card payment).
type Session = {
  id: string;
  url: string;
  status: string;
  payment_status: string;
  amount_total: number;
  payment_intent: string | null;
  metadata: Record<string, string>;
  success_url: string;
  cancel_url: string;
  customer_email: string | null;
  name: string;
};
const sessions = new Map<string, Session>();
let stripe: Server | undefined;

// Pretend email service (Resend) for this copy of the app: keeps what it's asked to send.
type SentEmail = { to: string[]; subject: string; text: string };
const mailbox: SentEmail[] = [];
let mail: Server | undefined;
test.beforeAll(async () => {
  if (!DB_URL) return;
  stripe = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1:3997");
      const json = (status: number, data: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };
      if (url.pathname.startsWith("/v1/") && req.headers.authorization !== "Bearer sk_test_e2e") return json(401, { error: { message: "bad key" } });
      if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
        const p = new URLSearchParams(body);
        const id = `cs_test_${sessions.size + 1}_${run}`;
        const s: Session = {
          id,
          url: `http://127.0.0.1:3997/pay/${id}`,
          status: "open",
          payment_status: "unpaid",
          amount_total: Number(p.get("line_items[0][price_data][unit_amount]")),
          payment_intent: null,
          metadata: { kind: p.get("metadata[kind]") ?? "", id: p.get("metadata[id]") ?? "" },
          success_url: p.get("success_url") ?? "",
          cancel_url: p.get("cancel_url") ?? "",
          customer_email: p.get("customer_email"),
          name: p.get("line_items[0][price_data][product_data][name]") ?? "",
        };
        sessions.set(id, s);
        return json(200, s);
      }
      const get = url.pathname.match(/^\/v1\/checkout\/sessions\/(.+)$/);
      if (req.method === "GET" && get) {
        const s = sessions.get(decodeURIComponent(get[1]));
        return s ? json(200, s) : json(404, { error: { message: "No such session" } });
      }
      const page = url.pathname.match(/^\/pay\/(.+)$/);
      const s = page && sessions.get(page[1]);
      if (s && url.searchParams.has("pay")) {
        Object.assign(s, { status: "complete", payment_status: "paid", payment_intent: `pi_${s.id}` });
        res.writeHead(303, { Location: s.success_url.replace("{CHECKOUT_SESSION_ID}", s.id) });
        return res.end();
      }
      if (s) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(
          `<title>Pretend Stripe</title><h1>Pay £${(s.amount_total / 100).toFixed(2)}</h1><p>${s.name}</p><p>${s.customer_email}</p>` +
            `<a href="?pay=1">Pay</a> <a href="${s.cancel_url}">Back</a>`,
        );
      }
      json(404, { error: { message: "not found" } });
    });
  });
  await new Promise<void>((resolve) => stripe!.listen(3997, "127.0.0.1", resolve));
  mail = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const emails = JSON.parse(body || "[]") as SentEmail[];
      mailbox.push(...emails);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: emails.map((_, i) => ({ id: `email-${mailbox.length + i}` })) }));
    });
  });
  await new Promise<void>((resolve) => mail!.listen(3996, "127.0.0.1", resolve));

  // A member with a membership waiting for payment.
  sql(`
    with h as (insert into households (address_line1, postcode) values ('2 Card St', 'BB10 2CC') returning id),
    p as (insert into people (household_id, first_name, last_name, date_of_birth, email)
          select id, 'Cara', 'Card${run}', '1985-03-03', '${memberEmail}' from h returning id, household_id),
    m as (insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id, status, price_pence)
          select current_club_year_id(), (select id from membership_types where code = 'IS' and current_date between starts_on and ends_on),
                 p.id, p.household_id, 'awaiting_payment', 18500 from p returning id)
    insert into membership_people (membership_id, person_id) select m.id, p.id from m, p;
  `);
  sql(`update households h set lead_person_id = p.id from people p where p.household_id = h.id and p.email = '${memberEmail}'`);
});
test.afterAll(() => {
  stripe?.close();
  mail?.close();
});

async function latestCode(email: string) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string };
      const code = msg.Text.match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no login email arrived for ${email}`);
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:3101\/$/);
}

function signedEvent(type: string, session: Session) {
  const payload = JSON.stringify({ id: `evt_${session.id}`, type, data: { object: session } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
  return { payload, signature: `t=${t},v1=${v1}` };
}

test("a member pays by card on Stripe's page, leaves once, then pays and comes back to a confirmation", async ({ page }) => {
  await signIn(page, memberEmail);
  await page.goto("/profile/checkout");
  await expect(page.getByRole("region", { name: "Your order" })).toContainText(/Total to pay\s*£185/);
  // Card only: no test notice and no Direct Debit choice while Stripe is set up.
  await expect(page.getByText("Test checkout.")).toHaveCount(0);
  await expect(page.getByLabel("Direct Debit")).toHaveCount(0);
  const order = page.getByRole("region", { name: "Your order" });
  await order.getByRole("button", { name: "Add a boat" }).click();
  await order.getByRole("group", { name: "Boat 1" }).getByLabel("Class").fill("Laser");
  await order.getByRole("group", { name: "Boat 1" }).getByLabel("Sail number").fill("777");
  await page.getByRole("button", { name: "Pay £220 by card" }).click();

  // On (pretend) Stripe: the amount and the member's email. They go back without paying.
  await expect(page.getByRole("heading", { name: "Pay £220.00" })).toBeVisible();
  await expect(page.getByText(memberEmail)).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByText("Payment cancelled. Nothing has been taken.")).toBeVisible();
  // The boat they added waits on the order; nothing is paid.
  await expect(page.getByRole("region", { name: "Your order" })).toContainText(/Laser 777/);
  await expect(page.getByRole("region", { name: "Your order" })).toContainText(/Total to pay\s*£220/);
  expect(sql(`select count(*) from member_receipts r join people p on p.id = r.payer_person_id where p.email = '${memberEmail}' and r.status = 'paid'`)).toBe("0");

  // Second go: they pay.
  await page.getByRole("button", { name: "Pay £220 by card" }).click();
  await page.getByRole("link", { name: "Pay" }).click();
  await expect(page.getByText("Your payment of £220 by card is confirmed.")).toBeVisible();
  await expect(page.getByText("Your membership is now paid.")).toBeVisible();
  await expect(page.getByText("Test checkout.")).toHaveCount(0);
  expect(
    sql(`select string_agg(r.status || ' ' || r.amount_pence || ' ' || coalesce(r.provider_ref, '-'), ', ' order by r.created_at)
           from member_receipts r join people p on p.id = r.payer_person_id where p.email = '${memberEmail}'`),
  ).toMatch(/^failed 22000 -, paid 22000 pi_cs_test_\d+_/);
  expect(sql(`select string_agg(m.status::text, ',') from memberships m join people p on p.id = m.payer_person_id where p.email = '${memberEmail}'`)).toBe("active");
  expect(sql(`select string_agg(b.status::text, ',') from boat_storages b join people p on p.id = b.person_id where p.email = '${memberEmail}'`)).toBe("active");

  // One confirmation email from the Payment confirmation template, kept in the Email log.
  const confirmations = mailbox.filter((e) => e.to.includes(memberEmail));
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0].subject).toBe("Your Burwain membership payment");
  expect(confirmations[0].text).toContain("Hello Cara,");
  expect(confirmations[0].text).toMatch(/card payment of £220 for Individual Sailing \(1 Jan \d{4} to 31 Dec \d{4}\)/);
  expect(
    sql(`select c.purpose || ' ' || r.status from email_recipients r join email_campaigns c on c.id = r.campaign_id where r.email = '${memberEmail}'`),
  ).toBe("payment_confirmation sent");

  // Stripe's webhook for the same payment afterwards changes nothing, and sends no second email.
  const session = [...sessions.values()].at(-1)!;
  const { payload, signature } = signedEvent("checkout.session.completed", session);
  const res = await fetch(`${APP}/api/stripe/webhook`, { method: "POST", body: payload, headers: { "stripe-signature": signature } });
  expect(res.status).toBe(200);
  expect(sql(`select count(*) from member_receipts r join people p on p.id = r.payer_person_id where p.email = '${memberEmail}' and r.status = 'paid'`)).toBe("1");
  expect(mailbox.filter((e) => e.to.includes(memberEmail))).toHaveLength(1);
});

test("Stripe's webhook records a payment even if the member never comes back, and refuses a bad signature", async () => {
  // A second membership waiting for payment, started by card and paid on Stripe, but the browser closed.
  sql(`
    insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id, status, price_pence)
    select current_club_year_id(), (select id from membership_types where code = 'IS' and current_date between starts_on and ends_on),
           p.id, p.household_id, 'awaiting_payment', 5000 from people p where p.email = '${memberEmail}';
  `);
  const receipt = sql(`
    insert into member_receipts (payer_person_id, amount_pence, method, status)
    select id, 5000, 'card', 'pending' from people where email = '${memberEmail}' returning id;
  `);
  sql(`insert into member_receipt_lines (receipt_id, membership_id, description, amount_pence)
       select '${receipt}', m.id, 'test', 5000 from memberships m join people p on p.id = m.payer_person_id
        where p.email = '${memberEmail}' and m.status = 'awaiting_payment'`);
  const session: Session = {
    id: `cs_test_hook_${run}`, url: "", status: "complete", payment_status: "paid", amount_total: 5000,
    payment_intent: `pi_hook_${run}`, metadata: { kind: "receipt", id: receipt }, success_url: "", cancel_url: "", customer_email: null, name: "",
  };
  const bad = await fetch(`${APP}/api/stripe/webhook`, {
    method: "POST",
    body: JSON.stringify({ type: "checkout.session.completed", data: { object: session } }),
    headers: { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` },
  });
  expect(bad.status).toBe(400);
  expect(sql(`select status from member_receipts where id = '${receipt}'`)).toBe("pending");

  const { payload, signature } = signedEvent("checkout.session.completed", session);
  const ok = await fetch(`${APP}/api/stripe/webhook`, { method: "POST", body: payload, headers: { "stripe-signature": signature } });
  expect(ok.status).toBe(200);
  expect(sql(`select status || ' ' || provider_ref from member_receipts where id = '${receipt}'`)).toBe(`paid pi_hook_${run}`);
  expect(sql(`select count(*) from memberships m join people p on p.id = m.payer_person_id where p.email = '${memberEmail}' and m.status = 'awaiting_payment'`)).toBe("0");
});

test("a visitor applies on Join, leaves Stripe's page, pays from the try-again page and sees the thank-you", async ({ page }) => {
  await page.goto("/join");
  await page.waitForLoadState("networkidle");
  const form = page.getByRole("form", { name: "Join Burwain" });
  const club = await form.getByLabel("Membership type").locator("option", { hasText: /^Club Membership( \(.*\))?: £/ }).first().textContent();
  await form.getByLabel("Membership type").selectOption({ label: club! });
  const you = page.getByRole("region", { name: "Your details" });
  await you.getByLabel("First name").fill("Jo");
  await you.getByLabel("Last name").fill(`Cardjoin${run}`);
  await you.getByLabel("Date of birth").fill("1990-04-04");
  await you.getByLabel("Address line 1").fill("3 Card St");
  await you.getByLabel("Postcode").fill("BB10 3CC");
  await you.getByLabel(/^Email/).fill(`jo-${run}@example.test`);
  await expect(form.getByText("Test checkout.")).toHaveCount(0);
  await expect(form.getByLabel("Direct Debit")).toHaveCount(0);
  await form.getByRole("button", { name: /^Send application and pay £[\d.]+ by card$/ }).click();

  await expect(page.getByRole("heading", { name: /^Pay £/ })).toBeVisible();
  await expect(page.getByText(`jo-${run}@example.test`)).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("region", { name: "Payment not finished" })).toContainText("hasn't been paid for yet");
  expect(sql(`select count(*) || ' ' || count(paid_at) from membership_applications where contact_email = 'jo-${run}@example.test'`)).toBe("1 0");

  await page.getByRole("button", { name: /^Pay £[\d.]+ by card$/ }).click();
  await page.getByRole("link", { name: "Pay" }).click();
  await expect(page.getByRole("status")).toContainText("We've received your application for Club Membership");
  await expect(page.getByText(/Your payment of £[\d.]+ by card is confirmed\./)).toBeVisible();
  expect(
    sql(`select paid_method || ' ' || (provider_ref like 'pi_cs_test_%') from membership_applications where contact_email = 'jo-${run}@example.test'`),
  ).toBe("card true");

  // The Join confirmation email, once.
  const thanks = mailbox.filter((e) => e.to.includes(`jo-${run}@example.test`));
  expect(thanks).toHaveLength(1);
  expect(thanks[0].subject).toBe("Thank you for applying to join Burwain");
  expect(thanks[0].text).toMatch(/Hello Jo,[\s\S]*payment of £[\d.]+ for Club Membership/);

  // The try-again link no longer offers to take payment.
  const id = sql(`select id from membership_applications where contact_email = 'jo-${run}@example.test'`);
  await page.goto(`/join/pay?application=${id}`);
  await expect(page.getByRole("region", { name: "Nothing to pay" })).toBeVisible();
});
