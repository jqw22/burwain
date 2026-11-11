import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Signed-in tests. They need a local Supabase stack (`supabase start`) and run only when
// E2E_DB_URL and E2E_MAILPIT_URL are set. Each run creates its own family so runs don't clash.
const DB_URL = process.env.E2E_DB_URL;
const MAILPIT_URL = process.env.E2E_MAILPIT_URL;
const SHOTS = process.env.E2E_SCREENSHOTS; // optional folder for screenshots

test.skip(!DB_URL || !MAILPIT_URL, "needs a local Supabase stack (E2E_DB_URL, E2E_MAILPIT_URL)");
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const leadEmail = `lead-${run}@example.test`;
const strangerEmail = `stranger-${run}@example.test`;
const adminEmail = `admin-${run}@example.test`;

function sql(statement: string) {
  return execFileSync("psql", [DB_URL!, "-v", "ON_ERROR_STOP=1", "-qtAc", statement], { encoding: "utf8" }).trim();
}

test.beforeAll(() => {
  if (!DB_URL) return;
  // A family: the lead adult (Sam) with a paid Family membership, a second adult and a junior.
  sql(`
    with h as (
      insert into households (address_line1, address_line3, postcode)
      values ('1 Lakeside', 'Burnley', 'BB10 1AA') returning id
    ), lead as (
      insert into people (household_id, first_name, last_name, date_of_birth, email, mobile)
      select id, 'Sam', 'Tester${run}', '1980-05-01', '${leadEmail}', '07700 900001' from h returning id, household_id
    ), others as (
      insert into people (household_id, first_name, last_name, date_of_birth, email)
      select household_id, 'Alex', 'Tester${run}', '1982-07-12', 'alex-${run}@example.test' from lead
      union all
      select household_id, 'Robin', 'Tester${run}', (current_date - interval '12 years')::date, null from lead
      returning id
    ), m as (
      insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id, status, price_pence)
      select current_club_year_id(), (select id from membership_types where code = 'F'), lead.id, lead.household_id, 'active', 25500
        from lead returning id
    )
    insert into membership_people (membership_id, person_id)
    select m.id, p.id from m, (select id from lead union all select id from others) p;
  `);
  sql(`
    with a as (insert into people (first_name, last_name, date_of_birth, email) values ('Ada', 'Admin${run}', '1970-01-01', '${adminEmail}') returning id)
    insert into user_roles (person_id, role) select id, r::app_role from a, unnest(array['admin', 'finance']) r;
  `);
  // Rows inserted above aren't visible to an update in the same statement, so set the lead separately.
  sql(`update households h set lead_person_id = p.id from people p where p.household_id = h.id and p.email = '${leadEmail}'`);
});

async function latestEmail(email: string, find: (text: string) => string | undefined) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string; HTML: string };
      const found = find(`${msg.Text}\n${msg.HTML}`);
      if (found) return found;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no login email arrived for ${email}`);
}
const latestLink = (email: string) =>
  latestEmail(email, (t) => t.match(/https?:\/\/[^\s"<]+\/auth\/v1\/verify[^\s"<]+/)?.[0]?.replace(/[)\]>]+$/, "").replaceAll("&amp;", "&"));
const latestCode = (email: string) => latestEmail(email, (t) => t.match(/\b(\d{6})\b/)?.[1]);

async function requestCode(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("We've emailed a 6-digit code to")).toBeVisible();
}

// Members normally sign in by typing the 6-digit code from the email.
async function signIn(page: Page, email: string) {
  await requestCode(page, email);
  await page.getByLabel("6-digit code").fill(await latestCode(email));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/localhost:3100\/$/);
}

// The link in the same email still works too, in the browser that asked for it.
async function signInWithLink(page: Page, email: string) {
  await requestCode(page, email);
  await page.goto(await latestLink(email));
  await expect(page).toHaveURL(/localhost:3100\/$/);
}

// Sign the lead in once and share the session, as a real member would stay signed in.
let lead: BrowserContext;
async function leadPage(browser: import("@playwright/test").Browser) {
  if (!lead) {
    lead = await browser.newContext({ baseURL: "http://localhost:3100", locale: "en-GB", timezoneId: "Europe/London" });
    await signIn(await lead.newPage(), leadEmail);
  }
  return lead.newPage();
}
let admin: BrowserContext;
async function adminPage(browser: import("@playwright/test").Browser) {
  if (!admin) {
    admin = await browser.newContext({ baseURL: "http://localhost:3100", locale: "en-GB", timezoneId: "Europe/London" });
    await signInWithLink(await admin.newPage(), adminEmail);
  }
  const page = await admin.newPage();
  await page.goto("/");
  return page;
}
test.afterAll(async () => {
  await lead?.close();
  await admin?.close();
  mailServer?.close();
});

// A pretend email service standing in for Resend (playwright.config.ts points the app at it).
// It keeps what it's asked to send, and refuses anything addressed to a "quota" address as if the daily limit was hit.
type SentEmail = { from: string; to: string[]; subject: string; text: string; html: string };
const mailbox: SentEmail[] = [];
let mailServer: Server | undefined;
test.beforeAll(async () => {
  if (!DB_URL) return;
  mailServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const emails = JSON.parse(body || "[]") as SentEmail[];
      res.setHeader("Content-Type", "application/json");
      if (req.headers.authorization !== "Bearer test-key") {
        res.statusCode = 401;
        return res.end(JSON.stringify({ message: "bad key" }));
      }
      if (emails.some((e) => e.to.some((t) => t.includes("quota")))) {
        res.statusCode = 429;
        return res.end(JSON.stringify({ name: "daily_quota_exceeded", message: "You have reached your daily email sending quota." }));
      }
      mailbox.push(...emails);
      res.end(JSON.stringify({ data: emails.map((_, i) => ({ id: `email-${mailbox.length + i}` })) }));
    });
  });
  await new Promise<void>((resolve) => mailServer!.listen(3998, "127.0.0.1", resolve));
});

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test("a member signs in with an email link and sees their membership", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome, Sam" })).toBeVisible();
  await expect(page.getByText(/Family \(\d{4}\):/)).toBeVisible();
  await expect(page.getByText("Paid")).toBeVisible();
  // Sign out is in the top bar, and the page you're on is marked there.
  await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("main").getByRole("button", { name: "Sign out" })).toHaveCount(0);
  // The login is now linked to Sam's member record.
  expect(sql(`select auth_user_id is not null from people where email = '${leadEmail}'`)).toBe("t");
  await shot(page, "home");
});

test("a member updates their own details, medical info and qualifications", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/profile");
  // Membership type, cost and payment status at the top.
  await expect(page.getByRole("region", { name: "Your membership" })).toContainText(/Family for Sam, Alex, Robin: £255\s*Paid/);
  const contact = page.getByRole("region", { name: "Contact details" });
  // Boxes show details read-only until you click Edit.
  await expect(contact.getByText("Not given").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save details" })).toHaveCount(0);
  await contact.getByRole("link", { name: "Edit contact details" }).click();
  await expect(contact.getByLabel("First name")).toHaveValue("Sam");

  await contact.getByLabel("Mobile", { exact: true }).fill("07700 900123");
  await contact.getByLabel("Emergency contact name").fill("Pat Tester");
  await contact.getByLabel("I'm happy to be contacted on WhatsApp").check();
  await contact.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("region", { name: "Contact details" })).toContainText("07700 900123");
  await expect(page.getByRole("region", { name: "Contact details" })).toContainText("Happy to be contacted on WhatsAppYes");
  expect(sql(`select mobile || '|' || whatsapp from people where email = '${leadEmail}'`)).toBe("07700 900123|true");

  await page.getByRole("link", { name: "Edit medical information" }).click();
  await page.getByLabel("Medical details").fill("Mild asthma, inhaler in kit bag.");
  await page.getByLabel("I agree to the club holding this information").check();
  await page.getByRole("button", { name: "Save medical information" }).click();
  await expect(page.getByRole("region", { name: "Your medical information" })).toContainText("Mild asthma, inhaler in kit bag.");
  expect(sql(`select count(*) from medical_records r join people p on p.id = r.person_id where p.email = '${leadEmail}'`)).toBe("1");

  await page.getByRole("link", { name: "Edit qualifications" }).click();
  await page.getByRole("textbox", { name: /^Qualification/ }).fill("RYA Dinghy Level 2");
  await page.getByLabel("Awarded").fill("2024-06-30");
  await page.getByLabel("Expires").fill("2028-06-30");
  await page.getByRole("button", { name: "Add qualification" }).click();
  await expect(page.getByText("RYA Dinghy Level 2")).toBeVisible();
  await expect(page.getByText("Awarded 30 Jun 2024 · Expires 30 Jun 2028")).toBeVisible();
  await shot(page, "profile");
});

test("the family lead sees the family on Your details and manages family members' details", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/profile");
  const family = page.getByRole("region", { name: "Your family" });
  await expect(family.getByText(`Alex Tester${run}`)).toBeVisible();
  await expect(family.getByText(`Robin Tester${run}`)).toBeVisible();
  await expect(family.getByText("junior, 12")).toBeVisible();

  // Adding someone new to the club is an admin job, so members can't add family members themselves.
  await expect(family.getByRole("link", { name: "Add a family member" })).toHaveCount(0);
  await expect(family.getByText("To add someone new to your family, please contact the membership secretary.")).toBeVisible();
  await shot(page, "profile-family");

  // Medical information for the junior.
  await page.getByRole("link", { name: `Edit Robin Tester${run}` }).click();
  // Wait for the page to finish loading, or the browser can reset a box typed into too early.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Happy to be contacted on WhatsApp").check();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Details saved.")).toBeVisible();
  expect(sql(`select whatsapp from people where first_name = 'Robin' and last_name = 'Tester${run}'`)).toBe("t");
  await page.goto("/profile");
  await expect(page.getByRole("region", { name: "Your family" }).getByRole("listitem").filter({ hasText: `Robin Tester${run}` })).toContainText("WhatsApp: yes");
  await page.getByRole("link", { name: `Edit Robin Tester${run}` }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Medical details").fill("Hay fever.");
  await page.getByLabel(/I agree to the club holding this information/).check();
  await page.getByRole("button", { name: "Save medical information" }).click();
  await expect(page.getByText("Medical information saved.")).toBeVisible();
  await expect(page.getByLabel("Medical details")).toHaveValue("Hay fever.");
  expect(sql(`select details from medical_records r join people p on p.id = r.person_id where p.first_name = 'Robin' and p.last_name = 'Tester${run}'`)).toBe("Hay fever.");
  await shot(page, "family-member-medical");

  // The main contact manages adults in the family too: a qualification for Alex.
  await page.goto("/profile");
  await page.getByRole("link", { name: `Edit Alex Tester${run}` }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: /^Qualification/ }).fill("Powerboat Level 2");
  await page.getByRole("button", { name: "Add qualification" }).click();
  await expect(page.getByText("Qualifications updated.")).toBeVisible();
  await expect(page.getByText("Powerboat Level 2")).toBeVisible();

  // The old Family page now opens Your details.
  await page.goto("/family");
  await expect(page).toHaveURL(/\/profile/);
  await expect(page.getByRole("link", { name: "Family", exact: true })).toHaveCount(0);
});

test("the family's main contact renews for next year from Your details", async ({ browser }) => {
  // Renewals open 60 days before the next club year starts.
  const next = sql(`select label from club_years where current_date between starts_on - 60 and starts_on - 1`);
  test.skip(!next, "renewals aren't open today");
  const page = await leadPage(browser);
  await page.goto("/profile");
  const box = page.getByRole("region", { name: "Your membership" });
  await expect(box.getByText(/Family for Sam, Alex, Robin: £255\s*Paid/)).toBeVisible();
  await expect(box.getByRole("heading", { name: `Renew for ${next}` })).toBeVisible();
  await expect(box.getByRole("link", { name: /Join|add a membership/i })).toHaveCount(0);
  await shot(page, "renew-before");

  // Members can only renew: no choosing a different or extra membership type.
  await expect(box.getByRole("link", { name: "Change membership type" })).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  // The old Membership page now opens Your details.
  await page.goto("/membership");
  await expect(page).toHaveURL(/\/profile/);

  await page.goto("/profile");
  // The member must confirm their details are up to date before renewing.
  const confirm = page.getByLabel(/I confirm that all my personal details .*are up to date/);
  await expect(confirm).not.toBeChecked();
  await page.getByRole("button", { name: `Renew for ${next}` }).click();
  await expect(page).toHaveURL(/\/profile(\?|#|$)/); // the browser stops the form until the box is ticked
  await confirm.check();
  await page.getByRole("button", { name: `Renew for ${next}` }).click();

  // A test checkout: the order, a choice of card or Direct Debit, and a Pay button. No money is taken.
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await expect(page.getByText("Renewed.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your order" })).toContainText(`Family ${next}`);
  await expect(page.getByRole("region", { name: "Your order" })).toContainText(/Total to pay\s*£255/);
  await expect(page.getByText("Test checkout.")).toBeVisible();
  await shot(page, "checkout");
  await page.getByLabel("Direct Debit").check();
  await page.getByRole("button", { name: "Pay £255" }).click();
  await expect(page.getByText("Your payment of £255 by Direct Debit is confirmed.")).toBeVisible();
  await shot(page, "checkout-confirmed");
  await page.getByRole("link", { name: "Back to Your details" }).click();
  await expect(page.getByRole("region", { name: "Your membership" }).getByText(/Family for Sam, Alex, Robin: £255\s*Awaiting payment/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Pay now" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Renew for ${next}` })).toHaveCount(0);
  expect(
    sql(`select count(*) from memberships m join club_years cy on cy.id = m.club_year_id join people p on p.id = m.payer_person_id
         where p.email = '${leadEmail}' and cy.label = '${next}' and m.status = 'awaiting_payment'`),
  ).toBe("1");
  await shot(page, "renew-after");
});

test("an admin's home page has Membership admin, Admin communications and Finance admin sections", async ({ browser }) => {
  const page = await adminPage(browser);
  const section = (name: string) => page.getByRole("main").locator("section", { has: page.getByRole("heading", { name, exact: true }) });
  const links = async (name: string) => (await section(name).getByRole("link").allTextContents()).map((t) => t.trim());
  expect(await links("Membership admin")).toEqual(["Members", "Applications", "Membership types", "Import", "Public join form"]);
  expect(await links("Admin communications")).toEqual(["Email templates", "Renewal reminders"]);
  expect(await links("Finance admin")).toEqual(["Income"]);

  // The Members bar no longer has Add new member, Income or Email templates.
  await section("Membership admin").getByRole("link", { name: "Members", exact: true }).click();
  const bar = page.getByRole("navigation", { name: "Membership admin" });
  await expect(page.getByRole("heading", { name: "Members", exact: true })).toBeVisible();
  await expect(bar.getByRole("link")).toHaveText(["Members", "Applications", "Membership types", "Import"]);
  await page.goto("/");
  await shot(page, "admin-home");
});

test("an admin imports the member spreadsheet after checking a preview", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await page.getByLabel("Member spreadsheet (.xlsx)").setInputFiles("e2e/fixtures/members.xlsx");
  await page.getByRole("button", { name: "Check spreadsheet" }).click();

  await expect(page.getByText("4 people in 2 families")).toBeVisible();
  await expect(page.getByText("Hazel Fixture")).toBeVisible();
  await expect(page.getByText(/born 01\/02\/1955/)).toBeVisible();
  await shot(page, "import-preview");

  await page.getByRole("button", { name: "Import 4 people" }).click();
  await expect(page.getByText("Import finished")).toBeVisible();
  // The fixture is the same every run, so later runs skip people already imported.
  expect(sql(`select count(*) from people where last_name = 'Fixture' and household_id is not null`)).toBe("3");
  expect(sql(`select count(distinct household_id) from people where last_name = 'Fixture'`)).toBe("1");
});

test("an admin finds a member, edits them and views their medical details", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await page.getByLabel("Search members").fill(`Tester${run}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(/3 people matching/)).toBeVisible();
  // Separate Type, Payment and Status columns; no Postcode.
  const headers = (await page.getByRole("columnheader").allTextContents()).map((t) => t.replace("▲", "").trim());
  expect(headers).toEqual(["Name", "Email", "Mobile", "Type", "Payment", "Status"]);
  const sam = page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) });
  await expect(sam.getByRole("cell").nth(3)).toHaveText("Family");
  await expect(sam.getByRole("cell").nth(4)).toContainText("Paid");
  await expect(sam.getByRole("cell").nth(5)).toHaveText("Active");
  await shot(page, "admin-members");

  // Filter by membership status. Pat's membership this year has lapsed.
  sql(`
    with p as (insert into people (first_name, last_name, date_of_birth) values ('Pat', 'Tester${run}', '1960-03-03') returning id),
    m as (insert into memberships (club_year_id, membership_type_id, payer_person_id, status, price_pence)
          select current_club_year_id(), (select id from membership_types where code = 'IS'), p.id, 'lapsed', 10000 from p
          returning id, payer_person_id)
    insert into membership_people (membership_id, person_id) select id, payer_person_id from m;
  `);
  await page.reload();
  await page.getByRole("link", { name: /^Lapsed \(\d+\)$/ }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Pat`) })).toContainText("Lapsed");
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) })).toHaveCount(0);
  await shot(page, "admin-members-lapsed");
  await page.getByRole("link", { name: /^Active \(\d+\)$/ }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Pat`) })).toHaveCount(0);
  // Sort by type keeps the search and filter.
  await page.getByRole("link", { name: "Type" }).click();
  await expect(page).toHaveURL(/sort=type/);
  await expect(page).toHaveURL(/status=active/);
  await expect(page.getByLabel("Search members")).toHaveValue(`Tester${run}`);
  await page.getByRole("link", { name: /^All \(\d+\)$/ }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Pat`) })).toBeVisible();
  await page.getByLabel("Search members").fill(`Tester${run}`);
  await page.getByRole("button", { name: "Search" }).click();

  await page.getByRole("link", { name: `Tester${run}, Sam` }).click();
  // Same boxes as Your details, read-only until Edit is clicked.
  await expect(page.getByRole("region", { name: "Contact details" })).toContainText("07700 900123");
  await page.getByRole("link", { name: "Edit contact details" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("First joined").fill("2015-04-01");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Details saved.")).toBeVisible();
  expect(sql(`select first_joined_on from people where email = '${leadEmail}'`)).toBe("2015-04-01");

  await page.getByRole("button", { name: "Show medical information" }).click();
  await expect(page.getByText("Mild asthma, inhaler in kit bag.")).toBeVisible();
  expect(sql(`select count(*) from medical_access_log l join people p on p.id = l.person_id where p.email = '${leadEmail}'`)).toBe("1");

  // Admins can edit medical information (a logged view), qualifications and preferences too.
  await page.getByRole("link", { name: "Edit medical information" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Medical details").fill("Mild asthma, inhaler in kit bag. Carries an EpiPen.");
  await page.getByRole("button", { name: "Save medical information" }).click();
  await expect(page.getByText("Medical information saved.")).toBeVisible();
  await expect(page.getByText("Carries an EpiPen.")).toBeVisible();
  await page.getByRole("link", { name: "Edit qualifications" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("textbox", { name: /^Qualification/ }).fill("First Aid");
  await page.getByRole("button", { name: "Add qualification" }).click();
  await expect(page.getByText("Qualifications updated.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Qualifications" })).toContainText("First Aid");
  await page.getByRole("link", { name: "Edit communication preferences" }).click();
  await page.getByLabel("Club news and newsletters by email").check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  expect(sql(`select news_consent, news_consent_at is not null from people where email = '${leadEmail}'`)).toBe("t|t");
  await shot(page, "admin-member");
});

test("an admin approves an Associate membership and finance records a cheque for it", async ({ browser }) => {
  // Alex has asked for an Associate membership, which needs approval.
  sql(`
    with m as (
      insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id, status, price_pence)
      select current_club_year_id(), (select id from membership_types where code = 'A'), p.id, p.household_id, 'pending_approval', 3000
        from people p where p.email = 'alex-${run}@example.test' returning id, payer_person_id
    )
    insert into membership_people (membership_id, person_id) select id, payer_person_id from m;
  `);
  const page = await adminPage(browser);
  await page.getByRole("link", { name: "Income", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Income", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Awaiting committee approval" })).toBeVisible();
  await shot(page, "admin-memberships-approval");

  await page.getByRole("button", { name: `Approve Associate Membership for Alex Tester${run}` }).click();
  await expect(page.getByText("Membership approved.")).toBeVisible();

  await page.getByRole("checkbox", { name: `Mark Associate Membership for Alex Tester${run} as paid` }).check();
  await page.getByLabel("Paid by").selectOption("cheque");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(`Associate Membership .*Alex Tester${run}`) });
  await expect(row).toContainText("Paid");
  await expect(row).toContainText("cheque");
  expect(
    sql(`select m.status from memberships m join membership_people mp on mp.membership_id = m.id
          join people p on p.id = mp.person_id join membership_types t on t.id = m.membership_type_id
         where p.email = 'alex-${run}@example.test' and t.code = 'A'`),
  ).toBe("active");
  await shot(page, "admin-memberships");
});

test("an admin adds new members: joining a family, a new family paying cash, and a whole family", async ({ browser }) => {
  const page = await adminPage(browser);
  // Members not in a family can't set one up themselves any more.
  await page.getByRole("link", { name: "Your details" }).click();
  await expect(page.getByRole("button", { name: "Set up my family" })).toHaveCount(0);
  await expect(page.getByText("You're not in a family group.")).toBeVisible();

  // Charlie joins Sam's family and is covered by the Family membership.
  await page.goto("/admin/members");
  await page.getByRole("link", { name: "+ Add new member" }).click();
  await page.waitForLoadState("networkidle");
  const form = page.getByRole("form", { name: "Add new member" });
  // Membership type starts blank; the rest of the form appears once it's chosen.
  await expect(form.getByLabel("Membership type")).toHaveValue("");
  await expect(form.getByLabel("First name")).toHaveCount(0);
  await form.getByLabel("Membership type").selectOption({ label: "Join existing family / dual membership" });
  await form.getByLabel("First name").fill("Charlie");
  await form.getByLabel("Last name").fill(`Tester${run}`);
  await form.getByLabel("Date of birth").fill("2018-04-02");
  await expect(form.getByLabel("Address line 1")).toHaveCount(0);
  const familyLabel = await form.getByLabel("Which family?").locator("option", { hasText: `Tester${run}, Sam` }).textContent();
  await form.getByLabel("Which family?").selectOption({ label: familyLabel! });
  await form.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText("New member added.")).toBeVisible();
  // Sam's family has a Family membership, so more people can join it.
  await expect(page.getByRole("link", { name: "Add a new member to this family" })).toBeVisible();
  expect(
    sql(`select count(*) from membership_people mp join people p on p.id = mp.person_id
          join memberships m on m.id = mp.membership_id join membership_types t on t.id = m.membership_type_id
         where p.first_name = 'Charlie' and p.last_name = 'Tester${run}' and t.code = 'F' and m.club_year_id = current_club_year_id()`),
  ).toBe("1");

  // Nora starts a new family on Club Membership and pays cash. A missing postcode is explained first.
  await page.goto("/admin/members/new");
  await page.waitForLoadState("networkidle");
  const typeLabel = await form.getByLabel("Membership type").locator("option", { hasText: /^Club Membership: £/ }).textContent();
  await form.getByLabel("Membership type").selectOption({ label: typeLabel! });
  await form.getByLabel("Club year").selectOption({ index: 0 });
  const details = page.getByRole("region", { name: "Their details" });
  await details.getByLabel("First name").fill("Nora");
  await details.getByLabel("Last name").fill(`New${run}`);
  await details.getByLabel("Date of birth").fill("1984-05-05");
  // The address sits in the details box, under the name.
  await details.getByLabel("Address line 1").fill("7 Harbour St");
  await details.getByLabel("Postcode").fill("bb11 3dd");
  await details.getByLabel(/^Email/).fill(`nora-${run}@example.test`);
  // Both preferences start ticked.
  await expect(details.getByLabel("Happy to receive club news by email")).toBeChecked();
  await expect(details.getByLabel("Happy to be added to the club directory")).toBeChecked();
  await form.getByLabel("Payment received").selectOption("cash");
  await form.getByLabel("Medical details").fill("Type 1 diabetes.");
  await form.getByLabel("The member agrees to the club holding this information").check();
  await form.getByRole("textbox", { name: /^Qualification/ }).fill("RYA Powerboat Level 2");
  await form.getByLabel("Expires").fill("2029-05-01");
  await form.getByLabel("Happy to receive club news by email").check();
  await shot(page, "admin-add-member");
  await form.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText("New member added.")).toBeVisible();
  expect(
    sql(`select p.first_joined_on = current_date, h.postcode, h.lead_person_id = p.id
           from people p join households h on h.id = p.household_id where p.email = 'nora-${run}@example.test'`),
  ).toBe("t|BB11 3DD|t");
  // Club Membership covers one person, so no one else can join Nora's family.
  await expect(page.getByRole("link", { name: "Add a new member to this family" })).toHaveCount(0);
  expect(
    sql(`select m.status from memberships m join membership_people mp on mp.membership_id = m.id
          join people p on p.id = mp.person_id where p.email = 'nora-${run}@example.test'`),
  ).toBe("active");
  expect(
    sql(`select r.details, q.name, q.expires_on, p.news_consent, p.directory_opt_out from people p
           join medical_records r on r.person_id = p.id join qualifications q on q.person_id = p.id
          where p.email = 'nora-${run}@example.test'`),
  ).toBe("Type 1 diabetes.|RYA Powerboat Level 2|2029-05-01|t|f");

  // A whole family joins on a Family membership: membership type first, then up to 4 people.
  await page.goto("/admin/members/new");
  await page.waitForLoadState("networkidle");
  const familyType = await form.getByLabel("Membership type").locator("option", { hasText: /^Family: £/ }).textContent();
  await form.getByLabel("Membership type").selectOption({ label: familyType! });
  await form.getByLabel("Address line 1").fill("9 Reservoir Lane");
  await form.getByLabel("Postcode").fill("bb12 4ee");
  await page.getByRole("button", { name: "Add another person to this Family membership" }).click();
  await page.getByRole("button", { name: "Add another person to this Family membership" }).click();
  const names = [["Fay", "1984-02-02"], ["Gus", "1983-03-03"], ["Hope", "2015-06-06"]];
  for (const [i, [first, dob]] of names.entries()) {
    const person = page.getByRole("region", { name: i === 0 ? "Person 1 (main contact)" : `Person ${i + 1}` });
    await person.getByLabel("First name").fill(first);
    await person.getByLabel("Last name").fill(`Fam${run}`);
    await person.getByLabel("Date of birth").fill(dob);
  }
  await shot(page, "admin-add-family");
  await form.getByRole("button", { name: "Add 3 members" }).click();
  await expect(page.getByText("New member added.")).toBeVisible();
  expect(
    sql(`select count(distinct p.household_id), count(*), bool_and(t.code = 'F')
           from people p join membership_people mp on mp.person_id = p.id
           join memberships m on m.id = mp.membership_id join membership_types t on t.id = m.membership_type_id
          where p.last_name = 'Fam${run}'`),
  ).toBe("1|3|t");

  // The same email can't be added twice; what was typed stays in the form.
  await page.goto("/admin/members/new");
  await page.waitForLoadState("networkidle");
  await form.getByLabel("Membership type").selectOption({ label: typeLabel! });
  await form.getByLabel("First name").fill("Nora");
  await form.getByLabel("Last name").fill(`Again${run}`);
  await form.getByLabel("Date of birth").fill("1984-05-05");
  await form.getByLabel(/^Email/).fill(`nora-${run}@example.test`);
  await form.getByLabel("Address line 1").fill("7 Harbour St");
  await form.getByLabel("Postcode").fill("bb11 3dd");
  await form.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText(`Someone already uses nora-${run}@example.test.`)).toBeVisible();
  await expect(form.getByLabel("Last name")).toHaveValue(`Again${run}`);
});

test("a visitor applies on the public Join page, and an admin accepts one and declines another", async ({ browser }) => {
  const visitor = await browser.newContext({ baseURL: "http://localhost:3100", locale: "en-GB", timezoneId: "Europe/London" });
  const page = await visitor.newPage();
  await page.goto("/join");
  await page.waitForLoadState("networkidle");
  const form = page.getByRole("form", { name: "Join Burwain" });
  // Juniors join through a parent's Family membership, so Junior isn't offered.
  await expect(form.getByLabel("Membership type").locator("option", { hasText: /^Junior/ })).toHaveCount(0);
  const dual = await form.getByLabel("Membership type").locator("option", { hasText: /^Dual: £/ }).textContent();
  await form.getByLabel("Membership type").selectOption({ label: dual! });
  const one = page.getByRole("region", { name: "Person 1 (main contact)" });
  await one.getByLabel("First name").fill("Iris");
  await one.getByLabel("Last name").fill(`Joiner${run}`);
  await one.getByLabel("Date of birth").fill("1979-07-07");
  await one.getByLabel("Address line 1").fill("2 Boathouse Row");
  await one.getByLabel("Postcode").fill("bb9 1jj");
  await one.getByLabel(/^Email/).fill(`iris-${run}@example.test`);
  await one.getByLabel("Medical details").fill("Hay fever.");
  await one.getByLabel("I agree to the club holding this information").check();
  const two = page.getByRole("region", { name: "Person 2" });
  await two.getByLabel("First name").fill("Jon");
  await two.getByLabel("Last name").fill(`Joiner${run}`);
  await two.getByLabel("Date of birth").fill("1978-08-08");
  await shot(page, "join");
  await form.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByRole("status")).toContainText("We've received your application for Dual");
  await shot(page, "join-thanks");

  // A second application, which the admin will decline.
  await page.goto("/join");
  await page.waitForLoadState("networkidle");
  const club = await form.getByLabel("Membership type").locator("option", { hasText: /^Club Membership: £/ }).textContent();
  await form.getByLabel("Membership type").selectOption({ label: club! });
  const you = page.getByRole("region", { name: "Your details" });
  await you.getByLabel("First name").fill("Kay");
  await you.getByLabel("Last name").fill(`Spammy${run}`);
  await you.getByLabel("Date of birth").fill("1991-09-09");
  await you.getByLabel("Address line 1").fill("1 Nowhere");
  await you.getByLabel("Postcode").fill("XX1 1XX");
  await you.getByLabel(/^Email/).fill(`kay-${run}@example.test`);
  await form.getByRole("button", { name: "Send application" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await visitor.close();

  const admin = await adminPage(browser);
  await expect(admin.getByText(/\d+ waiting/)).toBeVisible();
  await admin.getByRole("link", { name: "Applications" }).click();
  const iris = admin.getByRole("region", { name: `Iris Joiner${run}: Dual` });
  await expect(iris).toContainText(`Jon Joiner${run}`);
  await expect(iris).toContainText("Given (visible on their member page once accepted)");
  await expect(iris).not.toContainText("Hay fever");
  await shot(admin, "admin-applications");
  await admin.getByRole("button", { name: `Accept Iris Joiner${run}` }).click();
  await expect(admin.getByText("Application accepted")).toBeVisible();
  expect(
    sql(`select count(*), count(distinct p.household_id), min(m.status::text), min(t.code)
           from people p join membership_people mp on mp.person_id = p.id join memberships m on m.id = mp.membership_id
           join membership_types t on t.id = m.membership_type_id where p.last_name = 'Joiner${run}'`),
  ).toBe("2|1|awaiting_payment|D");

  await admin.goto("/admin/applications");
  await admin.getByRole("region", { name: `Kay Spammy${run}: Club Membership` }).getByLabel("Reason (optional)").fill("Not a real person");
  await admin.getByRole("button", { name: `Decline Kay Spammy${run}` }).click();
  await expect(admin.getByText("Application declined")).toBeVisible();
  expect(sql(`select status, data is null from membership_applications where contact_email = 'kay-${run}@example.test'`)).toBe("declined|t");
  expect(sql(`select count(*) from people where last_name = 'Spammy${run}'`)).toBe("0");
});

test("members see a directory of adult members, without payment status", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/");
  await page.getByRole("link", { name: "Directory" }).click();
  await expect(page.getByRole("heading", { name: "Member directory" })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Alex`) })).toContainText("Family");
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Robin`) })).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(`Tester${run}, Sam`) })).toHaveCount(0);
  await expect(page.getByText("Paid", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { name: "Directory" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("banner").getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");
  await shot(page, "directory");

  // Search by name.
  await page.getByLabel("Search the directory").fill(`alex tester${run}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Alex`) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) })).toHaveCount(0);
  await expect(page.getByText(/1 of \d+ members matching/)).toBeVisible();
  await shot(page, "directory-search");
  await page.getByRole("link", { name: "Clear search" }).click();
  await expect(page.getByLabel("Search the directory")).toHaveValue("");
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Alex`) })).toBeVisible();
});

test("an admin adds a membership type, changes its price and makes it inactive", async ({ browser }) => {
  const name = `Windsurf ${run}`;
  const code = `W${run.slice(-5).toUpperCase()}`;
  const page = await adminPage(browser);
  await page.goto("/admin/members");
  await page.getByRole("link", { name: "Membership types" }).click();
  await expect(page.getByRole("heading", { name: "Membership types", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: "Family", exact: true })).toContainText("£255");

  await page.getByRole("link", { name: "Add a membership type" }).click();
  const form = page.getByRole("region", { name: "Add a membership type" });
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Short code").fill(code.toLowerCase());
  await form.getByLabel("Description").fill("Windsurfing only, own board.");
  await form.getByLabel("Price for a full year (£)").fill("60");
  await form.getByLabel("Category").selectOption("non_sailing");
  await shot(page, "admin-types-add");
  await form.getByRole("button", { name: "Add membership type" }).click();
  await expect(page.getByText("Membership type added.")).toBeVisible();
  const row = page.getByRole("row", { name });
  await expect(row).toContainText(`(${code})`);
  await expect(row).toContainText("£60");
  await expect(row).toContainText("Non-sailing");

  // A clash with an existing code is explained.
  await row.getByRole("link", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("region", { name: `Edit ${name}` });
  await edit.getByLabel("Short code").fill("F");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Another membership type already uses that short code.")).toBeVisible();
  await page.getByRole("region", { name: `Edit ${name}` }).getByLabel("Price for a full year (£)").fill("65.50");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Membership type saved.")).toBeVisible();
  await expect(page.getByRole("row", { name })).toContainText("£65.50");

  // Offered on Add new member while active, not once inactive.
  await page.goto("/admin/members/new");
  await expect(page.getByLabel("Membership type").locator("option", { hasText: name })).toHaveCount(1);
  await page.goto("/admin/types");
  await page.getByRole("button", { name: `Make inactive: ${name}` }).click();
  await expect(page.getByText("Membership type is now inactive.")).toBeVisible();
  await expect(page.getByRole("region", { name: /^Inactive/ }).getByRole("row", { name })).toBeVisible();
  expect(sql(`select is_open from membership_types where code = '${code}'`)).toBe("f");
  await shot(page, "admin-types");
  await page.goto("/admin/members/new");
  await expect(page.getByLabel("Membership type").locator("option", { hasText: name })).toHaveCount(0);
});

test("an admin edits the renewal reminder email with a live preview, and adds another template", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto("/admin/members");
  await page.getByRole("link", { name: "Email templates" }).click();
  await expect(page.getByRole("heading", { name: "Email templates", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: "Renewal reminder" })).toContainText("Renewal reminder");

  await page.getByRole("link", { name: "Edit Renewal reminder" }).click();
  const form = page.getByRole("form", { name: "Edit Renewal reminder" });
  const preview = page.getByRole("region", { name: "Preview" });
  // The preview fills in example member details as you type.
  await expect(preview).toContainText("Hello Sam,");
  await form.getByLabel("Subject").fill(`Renew for {renewal_year}, {first_name} ${run}`);
  await expect(preview).toContainText(`Renew for ${new Date().getFullYear() + 1}, Sam ${run}`);
  await shot(page, "admin-email-template");

  // A misspelt placeholder is caught.
  await form.getByLabel("Message").fill("Hello {firstname}");
  await expect(form.getByRole("alert")).toContainText("{firstname}");
  await form.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Some placeholders weren't recognised.")).toBeVisible();

  const again = page.getByRole("form", { name: "Edit Renewal reminder" });
  await again.getByLabel("Subject").fill(`Renew for {renewal_year}, {first_name} ${run}`);
  await again.getByLabel("Message").fill("Hello {first_name},\n\nPlease renew here: {renewal_link}");
  await again.getByRole("button", { name: "Save template" }).click();
  await expect(page.getByText("Email template saved.")).toBeVisible();
  await expect(page.getByRole("row", { name: "Renewal reminder" })).toContainText(`Renew for {renewal_year}, {first_name} ${run}`);

  // Only one template can be the renewal reminder.
  await page.getByRole("link", { name: "Add an email template" }).click();
  const add = page.getByRole("form", { name: "Add an email template" });
  await add.getByLabel("Template name").fill(`Open day ${run}`);
  await add.getByLabel("Used for").selectOption("renewal_reminder");
  await add.getByLabel("Subject").fill("Open day");
  await add.getByLabel("Message").fill("Hello {first_name}, come along!");
  await add.getByRole("button", { name: "Add template" }).click();
  await expect(page.getByText("Another template is already the renewal reminder.")).toBeVisible();
  const retry = page.getByRole("form", { name: "Add an email template" });
  await retry.getByLabel("Template name").fill(`Open day ${run}`);
  await retry.getByLabel("Subject").fill("Open day");
  await retry.getByLabel("Message").fill("Hello {first_name}, come along!");
  await retry.getByRole("button", { name: "Add template" }).click();
  await expect(page.getByText("Email template added.")).toBeVisible();
  await expect(page.getByRole("row", { name: `Open day ${run}` })).toContainText("General");
  await shot(page, "admin-email-templates");
});

test("a member can't open the email templates page", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/emails");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("an admin previews, tests and sends renewal reminders, and a daily limit is reported", async ({ browser }) => {
  // Rita has a 2026 membership and hasn't renewed; Quinn's email will hit the pretend daily limit.
  for (const [first, email] of [["Rita", `remind-${run}@example.test`], ["Quinn", `quota-${run}@example.test`]]) {
    sql(`
      with p as (insert into people (first_name, last_name, date_of_birth, email) values ('${first}', 'Remind${run}', '1985-03-03', '${email}') returning id),
      m as (insert into memberships (club_year_id, membership_type_id, payer_person_id, status, price_pence)
            select current_club_year_id(), (select id from membership_types where code = 'IS'), id, 'active', 18500 from p returning id, payer_person_id)
      insert into membership_people (membership_id, person_id) select id, payer_person_id from m;
    `);
  }
  const page = await adminPage(browser);
  await page.goto("/admin/members");
  await page.getByRole("link", { name: "Renewal reminders" }).click();
  await expect(page.getByRole("heading", { name: "Renewal reminders", exact: true })).toBeVisible();
  const rita = page.getByRole("row", { name: `Rita Remind${run}` });
  await expect(rita).toContainText("Individual Sailing");
  await expect(rita).toContainText("£185");
  await expect(rita).toContainText("Not yet");

  await rita.getByRole("link", { name: `Preview email for Rita Remind${run}` }).click();
  const preview = page.getByRole("region", { name: `Preview: Rita Remind${run}` });
  await expect(preview).toContainText("Hello Rita,");
  await expect(preview).toContainText("/profile#renew");
  await shot(page, "admin-reminders");

  await preview.getByRole("button", { name: "Send this as a test to me" }).click();
  await expect(page.getByText(`Test email sent to ${adminEmail}.`)).toBeVisible();
  const test1 = mailbox.find((e) => e.to[0] === adminEmail);
  expect(test1?.subject).toMatch(/^\[Test\] /);
  expect(test1?.text).toContain("Hello Rita,");
  expect(test1?.from).toBe("Burwain Test <club@example.test>");

  const form = page.getByRole("form", { name: "Send renewal reminders" });
  await form.getByRole("button", { name: "Untick everyone" }).click();
  await form.getByRole("checkbox", { name: `Send to Rita Remind${run}` }).check();
  await form.getByRole("button", { name: "Send to 1 member" }).click();
  await expect(page.getByRole("alertdialog", { name: "Confirm sending" })).toContainText("You're about to email 1 member.");
  await shot(page, "admin-reminders-confirm");
  await page.getByRole("button", { name: "Yes, send now" }).click();
  await expect(page.getByText("Sent 1 renewal reminder.")).toBeVisible();
  const sent = mailbox.find((e) => e.to[0] === `remind-${run}@example.test`);
  expect(sent?.html).toContain('<a href="http');
  expect(sent?.subject).not.toContain("{");
  // Already reminded, so not ticked again.
  await expect(page.getByRole("checkbox", { name: `Send to Rita Remind${run}` })).not.toBeChecked();
  await expect(page.getByRole("row", { name: `Rita Remind${run}` })).not.toContainText("Not yet");
  expect(
    sql(`select r.status from email_recipients r join people p on p.id = r.person_id where p.email = 'remind-${run}@example.test'`),
  ).toBe("sent");

  // Hitting the daily limit is reported, and nothing is marked as sent.
  const again = page.getByRole("form", { name: "Send renewal reminders" });
  await again.getByRole("button", { name: "Untick everyone" }).click();
  await again.getByRole("checkbox", { name: `Send to Quinn Remind${run}` }).check();
  await again.getByRole("button", { name: "Send to 1 member" }).click();
  await page.getByRole("button", { name: "Yes, send now" }).click();
  const limit = page.getByRole("alert").filter({ hasText: "Sent 0 of 1." });
  await expect(limit).toBeVisible();
  await expect(limit).toContainText("sending limit was reached");
  await expect(page.getByRole("row", { name: `Quinn Remind${run}` })).toContainText("Not yet");
});

test("a member can't open the renewal reminders page", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/reminders");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("a member can't open the membership types page", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/types");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("a member can't open the memberships and payments page", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/memberships");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("a member can't open the admin members page", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/members");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("a member can't open the import page", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/import");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("an email that isn't on the member list gets a clear message", async ({ page }) => {
  await requestCode(page, strangerEmail);
  // The screen shows which address the code went to, so a wrong autofill is easy to spot.
  await expect(page.getByRole("status")).toContainText(`st•••@example.test`);
  await shot(page, "login-code");
  // A wrong code gets a clear message and you can try again on the same screen.
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That code didn't work")).toBeVisible();
  await shot(page, "login-wrong-code");
  await page.getByLabel("6-digit code").fill(await latestCode(strangerEmail));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "We couldn't find your membership" })).toBeVisible();
});
