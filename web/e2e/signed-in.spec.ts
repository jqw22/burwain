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
      select current_club_year_id(), (select id from membership_types where code = 'F' and current_date between starts_on and ends_on), lead.id, lead.household_id, 'active', 25500
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
  await page.goto("/admin");
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
  // Everyone lands on Home. The top bar has Home, Member, Directory, Calendar, Volunteer and Handbook (members don't see Admin).
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to Burwain, Sam", exact: true })).toBeVisible();
  const bar = page.getByRole("banner").getByRole("link");
  await expect(bar).toHaveText(["Home", "Member", "Directory", "Calendar", "Volunteer", "Handbook"]);
  await expect(page.getByRole("banner").getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  for (const [name, path] of [["Calendar", "/calendar"], ["Volunteer", "/volunteer"]]) {
    await page.getByRole("banner").getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(page.getByText("Coming soon")).toBeVisible();
  }
  // The Admin page sends members back to Home.
  await page.goto("/admin");
  await expect(page).toHaveURL(/localhost:3100\/$/);
  await page.getByRole("banner").getByRole("link", { name: "Member" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "Welcome Sam", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your current membership" })).toContainText(/Family for Sam, Alex, Robin: £255\s*Paid/);
  // Sign out is in the top bar, and the page you're on is marked there. Members don't see Admin.
  await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Member" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("banner").getByRole("link", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: "Sign out" })).toHaveCount(0);
  // The login is now linked to Sam's member record.
  expect(sql(`select auth_user_id is not null from people where email = '${leadEmail}'`)).toBe("t");
  await shot(page, "home");
});

test("a member updates their own details, medical info and qualifications", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/profile");
  // Membership type, cost and payment status at the top.
  await expect(page.getByRole("region", { name: "Your current membership" })).toContainText(/Family for Sam, Alex, Robin: £255\s*Paid/);
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
  // Renewals open 60 days before a membership ends (31 December here), once types starting later are set up.
  const next = sql(`select to_char(min(starts_on), 'YYYY') from membership_types
       where is_open and starts_on > current_date and current_date >= make_date(extract(year from current_date)::int, 11, 1)`);
  test.skip(!next, "renewals aren't open today");
  const page = await leadPage(browser);
  await page.goto("/profile");
  const box = page.getByRole("region", { name: "Your current membership" });
  await expect(box.getByText(/Family for Sam, Alex, Robin: £255\s*Paid/)).toBeVisible();
  await expect(box.getByRole("heading", { name: "Renew your membership" })).toBeVisible();
  await expect(box.getByText(`Your membership ends on 31 Dec ${Number(next) - 1}.`)).toBeVisible();
  await expect(box.getByRole("link", { name: /Join|add a membership/i })).toHaveCount(0);
  await shot(page, "renew-before");

  // Members choose any type starting later for the people ticked, starting with the same type as now.
  const type = box.getByLabel("Membership type");
  await expect(type.locator("option:checked")).toHaveText("Family: £255");
  await expect(type.locator("option", { hasText: "Individual Sailing" })).toHaveCount(0); // covers one person, three are ticked
  await box.getByRole("checkbox", { name: /^Alex / }).uncheck();
  await box.getByRole("checkbox", { name: /^Robin / }).uncheck();
  await expect(type.locator("option", { hasText: "Individual Sailing" })).toHaveCount(1);
  await box.getByRole("checkbox", { name: /^Alex / }).check();
  await box.getByRole("checkbox", { name: /^Robin / }).check();
  await expect(type.locator("option:checked")).toHaveText("Family: £255");
  // The old Membership page now opens Your details.
  await page.goto("/membership");
  await expect(page).toHaveURL(/\/profile/);

  await page.goto("/profile");
  // After pressing Renew, the next screen asks whether their details are up to date.
  await page.getByRole("button", { name: "Renew", exact: true }).click();
  const question = page.getByRole("region", { name: "Are your personal details up to date?" });
  await expect(question).toBeVisible();
  await expect(page.getByRole("region", { name: "Your renewal" })).toContainText("Family for Sam");
  await shot(page, "renew-confirm");
  await question.getByRole("link", { name: "No, I need to update them first" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("button", { name: "Renew", exact: true }).click();
  await page.getByRole("button", { name: "Yes, they're up to date. Renew" }).click();

  // A test checkout: the order, a choice of card or Direct Debit, and a Pay button. No money is taken.
  await expect(page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  await expect(page.getByText("Renewed.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your order" })).toContainText(`Family1 Jan ${next} to 31 Dec ${next}`);
  await expect(page.getByRole("region", { name: "Your order" })).toContainText(/Total to pay\s*£255/);
  await expect(page.getByText("Test checkout.")).toBeVisible();
  await shot(page, "checkout");
  await expect(page.getByRole("link", { name: "Pay later" })).toHaveCount(0);
  // Boat storage at £35 a boat, up to 3, added to the same payment.
  const order = page.getByRole("region", { name: "Your order" });
  await order.getByRole("button", { name: "Add a boat" }).click();
  await order.getByRole("group", { name: "Boat 1" }).getByLabel("Class").fill("Laser");
  await order.getByRole("group", { name: "Boat 1" }).getByLabel("Sail number").fill("123456");
  await order.getByRole("button", { name: "Add a boat" }).click();
  await order.getByRole("button", { name: "Add a boat" }).click();
  await expect(order.getByRole("button", { name: "Add a boat" })).toHaveCount(0); // 3 is the most
  await order.getByRole("button", { name: "Remove boat 3" }).click();
  await order.getByRole("button", { name: "Remove boat 2" }).click();
  await expect(order).toContainText(/Total to pay\s*£290/);
  await shot(page, "checkout-boats");
  await page.getByLabel("Direct Debit").check();
  await page.getByRole("button", { name: "Pay £290" }).click();
  await expect(page.getByText("Your payment of £290 by Direct Debit is confirmed.")).toBeVisible();
  await shot(page, "checkout-confirmed");
  await expect(page.getByText("Your membership is now paid.")).toBeVisible();
  await page.getByRole("link", { name: "Back to Member" }).click();
  // The test payment is recorded: the membership is paid and the income is posted.
  await expect(page.getByRole("region", { name: "Your current membership" }).getByText(new RegExp(`Family for Sam, Alex, Robin: £255\\s*Paid\\s*1 Jan ${next}`))).toBeVisible();
  await expect(page.getByRole("link", { name: "Pay now" })).toHaveCount(0);
  // Once renewed, the box doesn't ask them to renew again.
  await expect(page.getByRole("region", { name: "Your current membership" }).getByRole("heading", { name: "Renew your membership" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your current membership" })).toContainText(/Laser 123456: £35\s*Paid/);
  await expect(page.getByRole("button", { name: "Renew", exact: true })).toHaveCount(0);
  expect(
    sql(`select count(*) from memberships m join club_years cy on cy.id = m.club_year_id join people p on p.id = m.payer_person_id
         where p.email = '${leadEmail}' and cy.label = '${next}' and m.status = 'active'`),
  ).toBe("1");
  expect(
    sql(`select r.method || ' ' || r.amount_pence || ' ' || count(tx.id)
           from member_receipts r join people p on p.id = r.payer_person_id
           join member_receipt_lines rl on rl.receipt_id = r.id left join transactions tx on tx.receipt_line_id = rl.id
          where p.email = '${leadEmail}' and r.status = 'paid' group by r.id`),
  ).toBe("direct_debit 29000 2");
  expect(
    sql(`select count(*) from transactions tx join transaction_categories c on c.id = tx.category_id
          where c.name = 'Boat storage' and tx.description = 'Boat storage ${next}: Laser 123456'`),
  ).toBe("1");
  await shot(page, "renew-after");
});

test("an admin's home page has Membership admin, Communications admin and Finance admin sections", async ({ browser }) => {
  const page = await adminPage(browser);
  const section = (name: string) => page.getByRole("main").locator("section", { has: page.getByRole("heading", { name, exact: true }) });
  const links = async (name: string) => (await section(name).getByRole("link").allTextContents()).map((t) => t.trim());
  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link")).toHaveText(["Home", "Member", "Directory", "Calendar", "Volunteer", "Handbook", "Admin"]);
  await expect(page.getByRole("banner").getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: /^Welcome/ })).toHaveCount(0);
  expect(await links("Membership admin")).toEqual(["Members", "Applications", "Membership types", "Import", "Public join form"]);
  expect(await links("Communications admin")).toEqual(["Send email", "Add contact", "Templates", "Email log"]);
  expect(await links("Finance admin")).toEqual(["Income", "Transactions", "Categories"]);

  // The Members bar no longer has Add new member, Income or Email templates.
  await section("Membership admin").getByRole("link", { name: "Members", exact: true }).click();
  const bar = page.getByRole("navigation", { name: "Membership admin" });
  await expect(page.getByRole("heading", { name: "Membership", exact: true })).toBeVisible();
  await expect(bar.getByRole("link")).toHaveText(["Members", "Applications", "Membership types", "Import"]);
  // The heading row links between the three admin areas; the one you're in is the heading.
  const areas = page.getByRole("navigation", { name: "Admin areas" });
  await expect(areas.getByRole("link")).toHaveText(["Membership", "Communications", "Finance"]);
  await expect(areas.getByRole("link", { name: "Membership" })).toHaveAttribute("aria-current", "page");
  await shot(page, "admin-areas");
  await areas.getByRole("link", { name: "Communications" }).click();
  // Communications opens on Send email.
  await expect(page).toHaveURL(/\/admin\/emails\/send$/);
  await expect(page.getByRole("navigation", { name: "Communications admin" }).getByRole("link", { name: "Send email" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Admin areas" }).getByRole("link", { name: "Communications" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Communications admin" })).toBeVisible();
  await page.getByRole("navigation", { name: "Admin areas" }).getByRole("link", { name: "Finance" }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Finance admin" })).toBeVisible();
  await page.getByRole("navigation", { name: "Admin areas" }).getByRole("link", { name: "Membership" }).click();
  await expect(page.getByRole("navigation", { name: "Membership admin" })).toBeVisible();
  await page.goto("/admin");
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
  // Results update as you type: there's no Search button.
  await expect(page.getByRole("button", { name: "Search" })).toHaveCount(0);
  await page.getByLabel("Search members").fill(`Tester${run}`);
  await expect(page.getByText(/3 people matching/)).toBeVisible();
  // The family stays together: Sam (main contact) first, then Alex and Robin indented under them.
  const names = (await page.getByRole("row").allTextContents()).slice(1).map((t) => t.match(/Tester\w*, (Sam|Alex|Robin)/)?.[1]);
  expect(names).toEqual(["Sam", "Alex", "Robin"]);
  // Type, Status, Renewal, Expected and Remind columns; no Payment, Postcode, Email or Mobile.
  const headers = (await page.getByRole("columnheader").allTextContents()).map((t) => t.replace("▲", "").trim());
  expect(headers).toEqual(["Name", "Type", "Status", "Renewal", "Expected", "Boats", "Remind"]);
  const sam = page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) });
  await expect(sam.getByRole("cell").nth(1)).toHaveText("Family");
  await expect(sam.getByRole("cell").nth(2)).toHaveText("Active");
  // The rules are explained at the top, and only Active and Lapsed have filter buttons.
  await expect(page.getByText("How status and renewal are worked out")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Filter by membership status" })).toContainText(/^Membership:/);
  const statusFilters = page.getByRole("navigation", { name: "Filter by membership status" }).getByRole("link");
  await expect(statusFilters).toHaveText([/^All \(\d+\)$/, /^Active \(\d+\)$/, /^Lapsed \(\d+\)$/]);
  // Renewal: Outstanding within 60 days of Sam's membership ending (unless next year's is paid), otherwise n/a.
  const renewal = sql(`
    select case when exists (
             select 1 from memberships m2 join membership_types t2 on t2.id = m2.membership_type_id
               join membership_people mp2 on mp2.membership_id = m2.id
              where mp2.person_id = p.id and t2.starts_on > current_date and m2.status = 'active') then 'Paid'
           when t.ends_on - current_date > 60 then 'n/a' else 'Outstanding' end
      from people p join membership_people mp on mp.person_id = p.id join memberships m on m.id = mp.membership_id
      join membership_types t on t.id = m.membership_type_id
     where p.email = '${leadEmail}' and current_date between t.starts_on and t.ends_on and m.status <> 'cancelled' limit 1`);
  await expect(sam.getByRole("cell").nth(3)).toHaveText(renewal);
  // Expected: the renewal fee (next period's same type, else the current type's price), only when Outstanding,
  // and once per membership, so it's on Sam's row but not Robin's.
  const fee = sql(`
    select coalesce((select n.annual_price_pence from membership_types n where n.code = t.code and n.starts_on > t.ends_on and n.is_open
                      order by n.starts_on limit 1), t.annual_price_pence)
      from people p join membership_people mp on mp.person_id = p.id join memberships m on m.id = mp.membership_id
      join membership_types t on t.id = m.membership_type_id
     where p.email = '${leadEmail}' and current_date between t.starts_on and t.ends_on and m.status <> 'cancelled' limit 1`);
  const feeText = `£${(Number(fee) / 100).toFixed(Number(fee) % 100 === 0 ? 0 : 2)}`;
  await expect(sam.getByRole("cell").nth(4)).toHaveText(renewal === "Outstanding" ? feeText : "");
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Robin`) }).getByRole("cell").nth(4)).toHaveText("");
  await page.getByRole("navigation", { name: "Filter by renewal status" }).getByRole("link", { name: new RegExp(`^${renewal} \\(\\d+\\)$`) }).click();
  await expect(page).toHaveURL(/renewal=/);
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Robin`) })).toBeVisible();
  await shot(page, "admin-members");
  await page.getByRole("link", { name: "Any", exact: true }).click();
  await expect(page).not.toHaveURL(/renewal=/);

  // Filter by membership status. Pat's membership this year has lapsed.
  sql(`
    with p as (insert into people (first_name, last_name, date_of_birth) values ('Pat', 'Tester${run}', '1960-03-03') returning id),
    m as (insert into memberships (club_year_id, membership_type_id, payer_person_id, status, price_pence)
          select current_club_year_id(), (select id from membership_types where code = 'IS' and current_date between starts_on and ends_on), p.id, 'lapsed', 10000 from p
          returning id, payer_person_id)
    insert into membership_people (membership_id, person_id) select id, payer_person_id from m;
  `);
  await page.reload();
  await page.getByRole("link", { name: /^Lapsed \(\d+\)$/ }).click();
  const pat = page.getByRole("row", { name: new RegExp(`Tester${run}, Pat`) });
  await expect(pat.getByRole("cell").nth(2)).toHaveText("Lapsed");
  // Lapsed within the last 90 days, so the renewal is Outstanding.
  await expect(pat.getByRole("cell").nth(3)).toHaveText("Outstanding");
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) })).toHaveCount(0);
  await shot(page, "admin-members-lapsed");
  await page.getByRole("link", { name: /^Active \(\d+\)$/ }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Pat`) })).toHaveCount(0);
  // Sort by type keeps the search and filter.
  await page.getByRole("link", { name: "Type", exact: true }).click();
  await expect(page).toHaveURL(/sort=type/);
  await expect(page).toHaveURL(/status=active/);
  await expect(page.getByLabel("Search members")).toHaveValue(`Tester${run}`);
  await page.getByRole("link", { name: /^All \(\d+\)$/ }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Pat`) })).toBeVisible();
  await page.getByLabel("Search members").fill(`Tester${run}`);
  await expect(page).toHaveURL(/q=Tester/);

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

test("finance records a cheque for an Associate membership, which no longer needs approval", async ({ browser }) => {
  // Alex has asked for an Associate membership. It goes straight to awaiting payment.
  sql(`
    with m as (
      insert into memberships (club_year_id, membership_type_id, payer_person_id, household_id, status, price_pence)
      select current_club_year_id(), (select id from membership_types where code = 'A' and current_date between starts_on and ends_on), p.id, p.household_id, 'awaiting_payment', 3000
        from people p where p.email = 'alex-${run}@example.test' returning id, payer_person_id
    )
    insert into membership_people (membership_id, person_id) select id, payer_person_id from m;
  `);
  const page = await adminPage(browser);
  await page.getByRole("link", { name: "Income", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  await expect(page.getByText("Awaiting approval")).toHaveCount(0);

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

test("finance sees this month's transactions with who paid, a running balance, search and date sort", async ({ browser }) => {
  // Insurance paid on the 1st of this month, a donation today, and a grant last month (outside the default dates).
  sql(`insert into transactions (occurred_on, description, direction, amount_pence, category_id, method)
       select date_trunc('month', current_date)::date, 'Boat insurance ${run}', 'out'::txn_direction, 45000, id, 'bank_transfer'::payment_method from transaction_categories where name = 'Insurance'
       union all
       select (date_trunc('month', current_date) - interval '1 day')::date, 'Old grant ${run}', 'in'::txn_direction, 99900, id, 'bank_transfer'::payment_method from transaction_categories where name = 'Other income'`);
  sql(`insert into transactions (occurred_on, description, direction, amount_pence, category_id, method)
       select current_date, 'Raffle donation ${run}', 'in'::txn_direction, 2550, id, 'cash'::payment_method from transaction_categories where name = 'Donations'`);
  const page = await adminPage(browser);
  await page.getByRole("main").getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Finance admin" }).getByRole("link")).toHaveText(["Transactions", "Categories"]);

  // This month by default: last month's grant isn't shown.
  const month = sql(`select to_char(date_trunc('month', current_date), 'YYYY-MM-DD') || '|' || to_char(date_trunc('month', current_date) + interval '1 month' - interval '1 day', 'YYYY-MM-DD')`).split("|");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(month[0]);
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(month[1]);
  await expect(page.getByRole("row", { name: new RegExp(`Old grant ${run}`) })).toHaveCount(0);

  const donation = page.getByRole("row", { name: new RegExp(`Raffle donation ${run}`) });
  const insurance = page.getByRole("row", { name: new RegExp(`Boat insurance ${run}`) });
  await expect(donation).toContainText("Donations");
  await expect(donation).toContainText("Cash");
  await expect(donation).toContainText("£25.50");
  await expect(insurance).toContainText("Bank transfer");
  await expect(insurance).toContainText("£450.00");

  // Who paid: the cheque Alex paid for their Associate membership.
  const cheque = page.getByRole("row", { name: new RegExp(`Associate Membership .*Alex Tester${run}`) });
  await expect(cheque).toContainText("Cheque");

  // Running balance from zero over every transaction ever recorded.
  const balance = Number(sql(`select sum(case direction when 'in' then amount_pence else -amount_pence end) from transactions`));
  const expected = `${balance < 0 ? "−" : ""}£${(Math.abs(balance) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
  await expect(donation.getByRole("cell").last()).toHaveText(expected);

  // Newest first, then oldest first after clicking the Date heading.
  const order = async () => {
    const rows = await page.getByRole("row").allTextContents();
    return rows.findIndex((t) => t.includes(`Raffle donation ${run}`)) < rows.findIndex((t) => t.includes(`Boat insurance ${run}`));
  };
  expect(await order()).toBe(true);
  await page.getByRole("link", { name: /^Date/ }).click();
  await expect(page.getByText("oldest first")).toBeVisible();
  expect(await order()).toBe(false);

  // A wider date range brings in last month's grant.
  await page.getByLabel("From", { exact: true }).fill(sql(`select to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM-DD')`));
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("row", { name: new RegExp(`Old grant ${run}`) })).toBeVisible();

  // Search by who paid.
  await page.getByLabel("Search transactions").fill(`Alex Tester${run}`);
  await expect(page.getByRole("row", { name: new RegExp(`Boat insurance ${run}`) })).toHaveCount(0);
  await expect(cheque).toBeVisible();
  await page.getByLabel("Search transactions").fill("");
  await page.goto("/admin/transactions");
  await expect(insurance).toBeVisible();
  await expect(insurance).toBeVisible();
});

test("finance adds a supplier payment by hand from the Transactions screen", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto("/admin/transactions");
  await page.getByRole("link", { name: "+ Add transaction" }).click();
  await expect(page.getByRole("heading", { name: "Add transaction", exact: true })).toBeVisible();
  // A category must be chosen: there's no Uncategorised option.
  await expect(page.getByLabel("Category")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Category").locator("option", { hasText: "Uncategorised" })).toHaveCount(0);
  await page.getByLabel("Money out (the club paid)").check();
  await page.getByLabel("Description").fill(`Sail repairs ${run}`);
  await page.getByLabel("Paid to / received from").fill(`Lakeside Sails ${run}`);
  await page.getByLabel("Amount (£)").fill("0");
  await page.getByLabel("Category").selectOption({ label: "Equipment" });
  await page.getByLabel("How paid").selectOption("Bank transfer");
  await shot(page, "admin-transaction-add");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Please give an amount in pounds")).toBeVisible();
  await expect(page.getByLabel("Description")).toHaveValue(`Sail repairs ${run}`);

  await page.getByLabel("Amount (£)").fill("£1,234.56");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added.")).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(`Sail repairs ${run}`) });
  await expect(row).toContainText(`Lakeside Sails ${run}`);
  await expect(row).toContainText("Equipment");
  await expect(row).toContainText("£1,234.56");
  expect(
    sql(`select t.direction || '|' || t.amount_pence || '|' || c.name || '|' || t.method || '|' || (t.recorded_by = p.id)
           from transactions t join transaction_categories c on c.id = t.category_id, people p
          where t.description = 'Sail repairs ${run}' and p.email = '${adminEmail}'`),
  ).toBe("out|123456|Equipment|bank_transfer|true");

  // Money out only offers money-out categories, and money in only money-in ones.
  await page.getByRole("link", { name: "+ Add transaction" }).click();
  const option = (name: string) => page.getByLabel("Category").locator("option", { hasText: new RegExp(`^${name}$`) });
  await expect(option("Equipment")).toHaveCount(1);
  await expect(option("Donations")).toHaveCount(0);
  await page.getByLabel("Category").selectOption({ label: "Equipment" });
  await page.getByLabel("Money in (the club received)").check();
  await expect(option("Donations")).toHaveCount(1);
  await expect(option("Equipment")).toHaveCount(0);
  await expect(page.getByLabel("Category")).toHaveValue("");

  await page.goto("/admin/transactions");
  await shot(page, "admin-transactions");
});

test("finance adds, renames and makes inactive a transaction category", async ({ browser }) => {
  const page = await adminPage(browser);
  const finance = page.getByRole("main").locator("section", { has: page.getByRole("heading", { name: "Finance admin", exact: true }) });
  await finance.getByRole("link", { name: "Categories", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  // Equipment was used by the sail repairs added earlier.
  await expect(page.getByRole("row", { name: /Equipment/ })).toContainText("1");
  // Subscriptions is used for member payments, so it can't be renamed or made inactive.
  await expect(page.getByRole("row", { name: /Subscriptions/ })).toContainText("used automatically for member payments");
  // The fixed categories sit at the bottom of each list.
  const names = async (title: string) =>
    (await page.getByRole("region", { name: title }).getByRole("row").allTextContents()).slice(1).map((t) => t.trim());
  expect((await names("Money out categories")).at(-1)).toContain("Payment fees");
  expect((await names("Money in categories")).slice(-2).map((t) => t.split(" ")[0])).toEqual(["Boat", "Subscriptions"]);
  await expect(page.getByRole("button", { name: "Make inactive: Subscriptions" })).toHaveCount(0);

  await page.getByLabel("Category name").fill(`Coaching ${run}`);
  await page.locator(`select[name="direction"]`).selectOption("out");
  await page.getByRole("button", { name: "Add category" }).click();
  await expect(page.getByText("Category added.")).toBeVisible();
  await page.getByLabel(`Name of Coaching ${run}`).fill(`Coaching fees ${run}`);
  await page.getByRole("button", { name: `Rename Coaching ${run}` }).click();
  await expect(page.getByText("Category renamed.")).toBeVisible();
  expect(sql(`select direction || '|' || is_active from transaction_categories where name = 'Coaching fees ${run}'`)).toBe("out|true");

  // An inactive category isn't offered for new transactions.
  await page.getByRole("button", { name: `Make inactive: Coaching fees ${run}` }).click();
  await expect(page.getByText("Category is now inactive.")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Coaching fees ${run}`) })).toContainText("Inactive");
  await shot(page, "admin-categories");
  await page.goto("/admin/transactions/new");
  await expect(page.getByLabel("Category").locator("option", { hasText: `Coaching fees ${run}` })).toHaveCount(0);

  await page.goto("/admin/categories");
  await page.getByRole("button", { name: `Make active: Coaching fees ${run}` }).click();
  await expect(page.getByText("Category is active again")).toBeVisible();
  await page.goto("/admin/transactions/new");
  await expect(page.getByLabel("Category").locator("option", { hasText: `Coaching fees ${run}` })).toHaveCount(1);
});

test("an admin adds new members: joining a family, a new family paying cash, and a whole family", async ({ browser }) => {
  const page = await adminPage(browser);
  // Members not in a family can't set one up themselves any more.
  await page.getByRole("link", { name: "Member", exact: true }).click();
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
  const typeLabel = await form.getByLabel("Membership type").locator("option", { hasText: /^Club Membership( \(.*\))?: £/ }).first().textContent();
  await form.getByLabel("Membership type").selectOption({ label: typeLabel! });
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
  const familyType = await form.getByLabel("Membership type").locator("option", { hasText: /^Family( \(.*\))?: £/ }).first().textContent();
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
  const dual = await form.getByLabel("Membership type").locator("option", { hasText: /^Dual( \(.*\))?: £/ }).first().textContent();
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
  // A boat, stored with the membership and paid with the application.
  const storage = page.getByRole("region", { name: "Boat storage" });
  await storage.getByRole("button", { name: "Add a boat" }).click();
  await storage.getByLabel("Class").fill("Topper");
  await storage.getByLabel("Sail number").fill("t555");
  await shot(page, "join");
  // Paying is part of applying (a test checkout: no money is taken). The payment is held until an admin accepts.
  await expect(form.getByText("Test checkout.")).toBeVisible();
  await expect(form.getByRole("button", { name: "Pay later" })).toHaveCount(0);
  await form.getByRole("button", { name: /^Pay £[\d.]+ and send application$/ }).click();
  await expect(page.getByRole("status")).toContainText("We've received your application for Dual");
  await expect(page.getByText(/Your payment of £[\d.]+ by card is confirmed\./)).toBeVisible();
  await shot(page, "join-thanks");
  // The payment shows in the finance transactions straight away.
  expect(sql(`select count(*) from transactions where party = 'Iris Joiner${run}' and direction = 'in' and receipt_line_id is null`)).toBe("2");

  // A second application, which the admin will decline.
  await page.goto("/join");
  await page.waitForLoadState("networkidle");
  const club = await form.getByLabel("Membership type").locator("option", { hasText: /^Club Membership( \(.*\))?: £/ }).first().textContent();
  await form.getByLabel("Membership type").selectOption({ label: club! });
  const you = page.getByRole("region", { name: "Your details" });
  await you.getByLabel("First name").fill("Kay");
  await you.getByLabel("Last name").fill(`Spammy${run}`);
  await you.getByLabel("Date of birth").fill("1991-09-09");
  await you.getByLabel("Address line 1").fill("1 Nowhere");
  await you.getByLabel("Postcode").fill("XX1 1XX");
  await you.getByLabel(/^Email/).fill(`kay-${run}@example.test`);
  await form.getByLabel("Direct Debit").check();
  await form.getByRole("button", { name: /^Pay £[\d.]+ and send application$/ }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await visitor.close();

  const admin = await adminPage(browser);
  await expect(admin.getByText(/\d+ waiting/)).toBeVisible();
  await admin.getByRole("link", { name: "Applications" }).click();
  const iris = admin.getByRole("region", { name: `Iris Joiner${run}: Dual` });
  await expect(iris).toContainText(`Jon Joiner${run}`);
  await expect(iris).toContainText("Given (visible on their member page once accepted)");
  await expect(iris).not.toContainText("Hay fever");
  await expect(iris).toContainText("Topper T555 (£35)");
  await expect(iris).toContainText(/Paid £[\d.]+ by card on [^.]*\. If you decline, they need a refund\./);
  await expect(admin.getByRole("region", { name: `Kay Spammy${run}: Club Membership` })).toContainText(/Paid £[\d.]+ by Direct Debit on [^.]*\. If you decline, they need a refund\./);
  await shot(admin, "admin-applications");
  await admin.getByRole("button", { name: `Accept Iris Joiner${run}` }).click();
  await expect(admin.getByText("Application accepted")).toBeVisible();
  expect(
    sql(`select count(*), count(distinct p.household_id), min(m.status::text), min(t.code)
           from people p join membership_people mp on mp.person_id = p.id join memberships m on m.id = mp.membership_id
           join membership_types t on t.id = m.membership_type_id where p.last_name = 'Joiner${run}'`),
  ).toBe("2|1|active|D");
  // Accepting records the payment they made when applying, and posts the income.
  expect(
    sql(`select r.method, count(tx.id)
           from member_receipts r join people p on p.id = r.payer_person_id
           join member_receipt_lines rl on rl.receipt_id = r.id left join transactions tx on tx.receipt_line_id = rl.id
          where p.email = 'iris-${run}@example.test' and r.status = 'paid' group by r.id`),
  ).toBe("card|2");
  expect(sql(`select count(*) from transactions where party = 'Iris Joiner${run}'`)).toBe("2"); // the same transactions, now linked
  expect(sql(`select string_agg(bs.boat_class || ' ' || bs.sail_number || ' ' || bs.status, ',') from boat_storages bs join people p on p.id = bs.person_id where p.email = 'iris-${run}@example.test'`)).toBe("Topper T555 active");

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
  await expect(page.getByRole("heading", { name: "Member Directory" })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Alex`) })).toContainText("Family");
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Robin`) })).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(`Tester${run}, Sam`) })).toHaveCount(0);
  await expect(page.getByText("Paid", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("link", { name: "Directory" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("banner").getByRole("link", { name: "Member" })).not.toHaveAttribute("aria-current", "page");
  await shot(page, "directory");

  // Search by name.
  await page.getByLabel("Search the directory").fill(`alex tester${run}`);
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Alex`) })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) })).toHaveCount(0);
  await expect(page.getByText(/1 of \d+ members matching/)).toBeVisible();
  await shot(page, "directory-search");
  await page.getByRole("link", { name: "Clear search" }).click();
  await expect(page.getByLabel("Search the directory")).toHaveValue("");
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Alex`) })).toBeVisible();
});

test("an admin renews a membership for a member", async ({ browser }) => {
  const next = sql(`select to_char(min(starts_on), 'YYYY') from membership_types
       where is_open and starts_on > current_date and current_date >= make_date(extract(year from current_date)::int, 11, 1)`);
  test.skip(!next, "renewals aren't open today");
  const pat = sql(`select id from people where first_name = 'Pat' and last_name = 'Tester${run}'`);
  const page = await adminPage(browser);
  await page.goto(`/admin/members/${pat}`);
  const box = page.getByRole("region", { name: "Membership" });
  const form = box.getByRole("form", { name: "Save membership" });
  // Every active type that hasn't ended is offered, with its dates.
  await form.getByLabel("Membership type").selectOption({ label: `Individual Sailing (1 Jan ${next} to 31 Dec ${next}): £185` });
  await shot(page, "admin-renew");
  await form.getByRole("button", { name: "Save membership" }).click();
  await expect(page.getByText("Membership added.")).toBeVisible();
  expect(
    sql(`select t.name || '|' || m.status || '|' || m.price_pence from memberships m join membership_types t on t.id = m.membership_type_id
          join club_years cy on cy.id = m.club_year_id where m.payer_person_id = '${pat}' and cy.label = '${next}'`),
  ).toBe("Individual Sailing|awaiting_payment|18500");
});

test("an admin adds a contact for the email list, with no membership", async ({ browser }) => {
  const page = await adminPage(browser);
  // Found in the Communications admin box on Home, not on the Members screen.
  await page.goto("/admin/members");
  await expect(page.getByRole("link", { name: "+ Add contact" })).toHaveCount(0);
  await page.goto("/admin");
  await page.getByRole("link", { name: "Add contact", exact: true }).click();
  // It sits under Communications, with the Communications tabs.
  await expect(page.getByRole("heading", { name: "Communications", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Communications admin" }).getByRole("link")).toHaveText(["Send email", "Add contact", "Templates", "Email log"]);
  // Cancel goes back to the Admin page.
  await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/admin");
  const form = page.getByRole("form", { name: "Add a contact" });
  await form.getByLabel("First name").fill("Cass");
  await form.getByLabel("Last name").fill(`Contact${run}`);
  await form.getByLabel("Email", { exact: true }).fill(`cass-${run}@example.test`);
  await shot(page, "admin-add-contact");
  await form.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("heading", { name: "Contact added" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(`Cass Contact${run} (cass-${run}@example.test) has been added`);
  await expect(page.getByRole("link", { name: "Add another contact" })).toBeVisible();
  expect(sql(`select is_contact, news_consent, household_id is null from people where email = 'cass-${run}@example.test'`)).toBe("t|t|t");
  // Contacts aren't members, so they aren't on the Members list.
  await page.goto(`/admin/members?q=Contact${run}`);
  await expect(page.getByText(/0 people matching/)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(`Contact${run}, Cass`) })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Contact \(\d+\)$/ })).toHaveCount(0);
});

test("an admin changes boat storage prices, and adds and removes boats on a member's page", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto("/admin/types");
  const prices = page.getByRole("region", { name: "Boat storage prices" });
  await expect(prices.getByRole("textbox", { name: /^Members rate/ })).toHaveValue("35");
  await expect(prices.getByRole("textbox", { name: /^Non-members rate/ })).toHaveValue("80");
  await prices.getByRole("textbox", { name: /^Members rate/ }).fill("36.50");
  await prices.getByRole("button", { name: "Save storage prices" }).click();
  await expect(page.getByText("Boat storage prices saved.")).toBeVisible();
  expect(sql(`select price_pence from boat_storage_options where members_rate`)).toBe("3650");
  await shot(page, "admin-storage-prices");
  await prices.getByRole("textbox", { name: /^Members rate/ }).fill("35");
  await prices.getByRole("button", { name: "Save storage prices" }).click();
  await expect(page.getByText("Boat storage prices saved.")).toBeVisible();

  // A member who didn't renew but left their boat: charged the non-members rate, paid in cash.
  const id = sql(`select id from people where email = '${leadEmail}'`);
  await page.goto(`/admin/members/${id}`);
  const card = page.getByRole("region", { name: "Boat storage" });
  await card.getByRole("link", { name: "Edit boat storage" }).click();
  const add = page.getByRole("form", { name: "Add a boat" });
  await add.getByLabel("Class").fill("Mirror");
  await add.getByLabel("Sail number").fill("70001");
  await add.getByLabel("Rate").selectOption("non_members");
  await add.getByLabel("Payment received").selectOption("cash");
  await add.getByRole("button", { name: "Add boat" }).click();
  await expect(page.getByText("Boat storage updated.")).toBeVisible();
  await expect(card).toContainText(/Mirror 70001: £80 \(non-members rate\), Paid/);
  // An unpaid one can be removed; a paid one can't.
  await add.getByLabel("Class").fill("Optimist");
  await add.getByLabel("Sail number").fill("99");
  await add.getByRole("button", { name: "Add boat" }).click();
  await expect(card).toContainText(/Optimist 99: £35, Awaiting payment/);
  await expect(card.getByRole("button", { name: "Remove Mirror 70001" })).toHaveCount(0);
  await shot(page, "admin-member-boats");
  await card.getByRole("button", { name: "Remove Optimist 99" }).click();
  await expect(page.getByText("Boat storage updated.")).toBeVisible();
  await expect(card).not.toContainText("Optimist");
  expect(
    sql(`select count(*) from transactions tx join transaction_categories c on c.id = tx.category_id
          where c.name = 'Boat storage' and tx.method = 'cash' and tx.amount_pence = 8000 and tx.description like '%Mirror 70001 (non-members rate)'`),
  ).toBe("1");

  // The Members list counts the boats stored.
  await page.goto(`/admin/members?q=lead-${run}`);
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) }).getByRole("cell").nth(5)).toHaveText(/^[1-3]$/);
});

test("an admin adds a membership type, changes its price and makes it inactive", async ({ browser }) => {
  const name = `Windsurf ${run}`;
  const code = `W${run.slice(-5).toUpperCase()}`;
  const page = await adminPage(browser);
  await page.goto("/admin/members");
  await page.getByRole("link", { name: "Membership types" }).click();
  await expect(page.getByRole("heading", { name: "Membership", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: "Family", exact: true }).first()).toContainText("£255");

  await page.getByRole("link", { name: "Add a membership type" }).click();
  const form = page.getByRole("region", { name: "Add a membership type" });
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Short code").fill(code.toLowerCase());
  await form.getByLabel("Description").fill("Windsurfing only, own board.");
  await form.getByLabel("Price for the whole period (£)").fill("60");
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
  await expect(page.getByText("Another membership type starting on the same day already uses that short code.")).toBeVisible();
  await page.getByRole("region", { name: `Edit ${name}` }).getByLabel("Price for the whole period (£)").fill("65.50");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Membership type saved.")).toBeVisible();
  await expect(page.getByRole("row", { name })).toContainText("£65.50");

  // Offered on Add new member while active, not once inactive.
  await page.goto("/admin/members/new");
  await expect(page.getByLabel("Membership type").locator("option", { hasText: name })).toHaveCount(1);
  await page.goto("/admin/types");
  await expect(page.getByRole("button", { name: "Make inactive" })).toHaveCount(0); // only on the edit screen
  await page.getByRole("link", { name: `Edit ${name}` }).click();
  await expect(page.getByRole("region", { name: `Edit ${name}` })).toBeVisible();
  await shot(page, "admin-types-edit");
  await page.getByRole("region", { name: `Edit ${name}` }).getByRole("button", { name: "Make inactive" }).click();
  await expect(page.getByText("Membership type is now inactive.")).toBeVisible();
  await expect(page.getByRole("region", { name: /^Inactive/ }).getByRole("row", { name })).toBeVisible();
  expect(sql(`select is_open from membership_types where code = '${code}'`)).toBe("f");
  await shot(page, "admin-types");
  await page.goto("/admin/members/new");
  await expect(page.getByLabel("Membership type").locator("option", { hasText: name })).toHaveCount(0);
});

test("an admin copies membership types to a year later, changes a price on the copy, and adds a June to March type", async ({ browser }) => {
  const latest = Number(sql(`select max(extract(year from starts_on))::int from membership_types where code = 'F'`));
  const next = latest + 1;
  const dates = (y: number) => `1 Jan ${y} to 31 Dec ${y}`;
  const page = await adminPage(browser);
  await page.goto("/admin/types");
  await expect(page.getByRole("navigation", { name: "Club year" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /approval/i })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: dates(latest) })).toBeVisible();
  await shot(page, "admin-types");
  await page.getByRole("button", { name: `Copy the types for ${dates(latest)} to a year later` }).click();
  await expect(page.getByText("Membership types copied with the dates a year later.")).toBeVisible();
  const copies = page.getByRole("table", { name: `Types for ${dates(next)}` });
  await expect(copies.getByRole("row", { name: "Family", exact: true })).toContainText("£255");

  await copies.getByRole("link", { name: "Edit Family" }).click();
  await page.getByRole("region", { name: `Edit Family (${dates(next)})` }).getByLabel("Price for the whole period (£)").fill("270");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Membership type saved.")).toBeVisible();
  await expect(copies.getByRole("row", { name: "Family", exact: true })).toContainText("£270");
  expect(
    sql(`select string_agg(extract(year from starts_on) || '=' || annual_price_pence, ',' order by starts_on) from membership_types
          where code = 'F' and extract(year from starts_on) in (${latest}, ${next})`),
  ).toBe(`${latest}=25500,${next}=27000`);

  // Any dates: a winter type from June to March, then copied on its own to the following year.
  await page.getByRole("link", { name: "Add a membership type" }).click();
  const add = page.getByRole("region", { name: "Add a membership type" });
  await add.getByLabel("Name").fill(`Winter ${run}`);
  await add.getByLabel("Short code").fill(`W${run}`.slice(0, 10).toUpperCase().replace(/[^A-Z0-9]/g, ""));
  await add.getByRole("textbox", { name: /^Start date/ }).fill(`${next}-06-01`);
  await add.getByRole("textbox", { name: /^End date/ }).fill(`${next + 1}-03-31`);
  await add.getByLabel("Price for the whole period (£)").fill("40");
  await page.getByRole("button", { name: "Add membership type" }).click();
  await expect(page.getByText("Membership type added.")).toBeVisible();
  const winter = page.getByRole("table", { name: `Types for 1 Jun ${next} to 31 Mar ${next + 1}` });
  await expect(winter.getByRole("row", { name: `Winter ${run}` })).toContainText("£40");
  await winter.getByRole("button", { name: `Copy Winter ${run} to a year later` }).click();
  await expect(page.getByText("Copied with the dates a year later.")).toBeVisible();
  await expect(page.getByRole("region", { name: `Edit Winter ${run} (1 Jun ${next + 1} to 31 Mar ${next + 2})` })).toBeVisible();
  await shot(page, "admin-types-copied");
});

test("an admin edits the renewal reminder email with a live preview, and adds another template", async ({ browser }) => {
  const page = await adminPage(browser);
  // Found in the Communications admin box on Home.
  await page.goto("/admin");
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Communications", exact: true })).toBeVisible();
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

  // There can be several renewal reminders, e.g. a final one.
  await page.getByRole("link", { name: "Add an email template" }).click();
  const add = page.getByRole("form", { name: "Add an email template" });
  await add.getByLabel("Template name").fill(`Final reminder ${run}`);
  await add.getByLabel("Used for").selectOption("renewal_reminder");
  await add.getByLabel("Subject").fill("Last chance to renew, {first_name}");
  await add.getByLabel("Message").fill("Hello {first_name}, this is your final reminder: {renewal_link}");
  await add.getByRole("button", { name: "Add template" }).click();
  await expect(page.getByText("Email template added.")).toBeVisible();
  await expect(page.getByRole("row", { name: `Final reminder ${run}` })).toContainText("Renewal reminder");
  await shot(page, "admin-email-templates");
});

test("a member can't open the email templates page", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/emails");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("an admin ticks members on the Members list, picks a reminder, previews, tests and sends it", async ({ browser }) => {
  // Rita and Quinn have a membership ending soon and haven't renewed; Quinn's email will hit the pretend daily limit.
  // Nell has no email address, which the send screen flags.
  for (const [first, email] of [["Rita", `'remind-${run}@example.test'`], ["Quinn", `'quota-${run}@example.test'`], ["Nell", "null"]]) {
    sql(`
      with p as (insert into people (first_name, last_name, date_of_birth, email) values ('${first}', 'Remind${run}', '1985-03-03', ${email}) returning id),
      m as (insert into memberships (club_year_id, membership_type_id, payer_person_id, status, price_pence)
            select current_club_year_id(), (select id from membership_types where code = 'IS' and current_date between starts_on and ends_on), id, 'active', 18500 from p returning id, payer_person_id)
      insert into membership_people (membership_id, person_id) select id, payer_person_id from m;
    `);
  }
  const page = await adminPage(browser);
  await page.goto(`/admin/members?q=Remind${run}`);
  const row = (first: string) => page.getByRole("row").filter({ hasText: `Remind${run}, ${first}` });
  // Nothing is ticked for you.
  for (const first of ["Rita", "Quinn", "Nell"]) await expect(row(first).getByRole("checkbox", { name: `Remind ${first} Remind${run}` })).not.toBeChecked();
  await row("Rita").getByRole("checkbox").check();
  await row("Nell").getByRole("checkbox").check();
  await shot(page, "members-remind-ticks");
  await page.getByRole("button", { name: "Send reminder…" }).click();

  await expect(page.getByRole("heading", { name: "Send renewal reminders" })).toBeVisible();
  await page.getByRole("combobox", { name: "Reminder" }).selectOption({ label: "Renewal reminder" });
  await page.getByRole("button", { name: "Use this reminder" }).click();
  const selected = page.getByRole("region", { name: /^2\. Members selected/ });
  await expect(selected.getByRole("row", { name: `Rita Remind${run}` })).toContainText("£185");
  await expect(selected.getByRole("row", { name: `Rita Remind${run}` })).toContainText("Not yet");
  await expect(selected.getByRole("row", { name: `Nell Remind${run}` })).toContainText("No email address");
  await expect(selected).not.toContainText("Quinn");
  const preview = page.getByRole("region", { name: `3. Preview: Rita Remind${run}` });
  await expect(preview).toContainText("Hello Rita,");
  await expect(preview).toContainText("/profile#renew");
  await shot(page, "remind-send-screen");

  await preview.getByRole("button", { name: "Send this as a test to me" }).click();
  await expect(page.getByText(`Test email sent to ${adminEmail}.`)).toBeVisible();
  const test1 = mailbox.find((e) => e.to[0] === adminEmail && e.text.includes("Hello Rita,"));
  expect(test1?.subject).toMatch(/^\[Test\] /);
  expect(test1?.from).toBe("Burwain Test <club@example.test>");

  // Nell has no email, so only Rita is sent it.
  await page.getByRole("button", { name: "Send to 1 member" }).click();
  await expect(page.getByRole("alertdialog", { name: "Confirm sending" })).toContainText("You're about to email 1 member.");
  await page.getByRole("button", { name: "Yes, send now" }).click();
  await expect(page.getByText("Sent 1 renewal reminder.")).toBeVisible();
  const sent = mailbox.find((e) => e.to[0] === `remind-${run}@example.test`);
  expect(sent?.html).toContain('<a href="http');
  expect(sent?.subject).not.toContain("{");
  await expect(page.getByRole("region", { name: /^2\. Members selected/ }).getByRole("row", { name: `Rita Remind${run}` })).toContainText("Already sent");

  // The Members list shows she was reminded; a different reminder template shows she hasn't had that one.
  await page.goto(`/admin/members?q=Remind${run}`);
  await expect(row("Rita")).toContainText("Reminded");
  await row("Rita").getByRole("checkbox").check();
  await row("Quinn").getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send reminder…" }).click();
  await page.getByRole("combobox", { name: "Reminder" }).selectOption({ label: `Final reminder ${run}` });
  await page.getByRole("button", { name: "Use this reminder" }).click();
  await expect(page.getByRole("region", { name: /^2\. Members selected/ }).getByRole("row", { name: `Rita Remind${run}` })).toContainText("Not yet");
  await expect(page.getByRole("region", { name: /^3\. Preview/ })).toContainText("final reminder");

  // Hitting the daily limit is reported (Quinn's address is refused, so the whole batch is).
  await page.getByRole("button", { name: "Send to 2 members" }).click();
  await page.getByRole("button", { name: "Yes, send now" }).click();
  const limit = page.getByRole("alert").filter({ hasText: "Sent 0 of 2." });
  await expect(limit).toBeVisible();
  await expect(limit).toContainText("sending limit was reached");
});

test("an admin sends a group email with a logo and a picture, and a contact unsubscribes", async ({ browser }) => {
  // Gail is a contact, Hugo has unsubscribed, Ivo is a junior contact (never listed); Sam (the family lead) is a current member.
  sql(`
    insert into people (first_name, last_name, date_of_birth, email, is_contact, emails_unsubscribed_at) values
      ('Gail', 'Group${run}', null, 'gail-${run}@example.test', true, null),
      ('Hugo', 'Group${run}', null, 'hugo-${run}@example.test', true, now()),
      ('Ivo', 'Group${run}', (current_date - interval '10 years')::date, 'ivo-${run}@example.test', true, null);
    insert into email_templates (name, purpose, subject, body)
      values ('Club news ${run}', 'general', 'Club news', E'Hello {first_name},\n\nThe clubhouse opens on Saturday.');
  `);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const page = await adminPage(browser);

  // The club logo is uploaded on the Templates page.
  await page.goto("/admin/emails");
  await page.getByLabel("Upload logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img", { name: "Club logo" })).toBeVisible();
  // Template previews show the logo too.
  await page.getByRole("link", { name: `Edit Club news ${run}` }).click();
  await expect(page.getByRole("region", { name: "Preview" }).getByRole("img", { name: "Burwain" })).toBeVisible();

  await page.getByRole("navigation", { name: "Communications admin" }).getByRole("link", { name: "Send email" }).click();
  await expect(page.getByRole("heading", { name: "Send a group email" })).toBeVisible();
  // Renewal reminders aren't offered; a general template fills in the email, which can then be changed.
  const write = page.getByRole("region", { name: "1. Write the email" });
  await expect(write.getByRole("combobox", { name: "Start from" }).locator("option", { hasText: "Renewal reminder" })).toHaveCount(0);
  await write.getByRole("combobox", { name: "Start from" }).selectOption({ label: `Template: Club news ${run}` });
  await expect(write.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Club news");
  await write.getByRole("textbox", { name: "Subject", exact: true }).fill(`Club news ${run}`);
  await write.getByLabel("Add image").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await expect(write.getByRole("textbox", { name: "Message", exact: true })).toHaveValue(/\[image: http[^\]]+\/email-images\/[0-9a-f-]+\]/);

  const who = page.getByRole("region", { name: /^2\. Choose who gets it/ });
  await who.getByPlaceholder("Search by name or email").fill(`Group${run}`);
  await expect(who.getByRole("row", { name: `Gail Group${run}` })).toContainText("Contact");
  await expect(who.getByRole("row", { name: `Hugo Group${run}` })).toContainText("Unsubscribed");
  await expect(who.getByRole("checkbox", { name: `Send to Hugo Group${run}` })).toBeDisabled();
  await expect(who.getByRole("row", { name: `Ivo Group${run}` })).toHaveCount(0);
  await who.getByRole("checkbox", { name: `Send to Gail Group${run}` }).check();
  await who.getByPlaceholder("Search by name or email").fill(`Tester${run}`);
  await expect(who.getByRole("row", { name: `Sam Tester${run}` })).toContainText("Current");
  await expect(who.getByRole("row", { name: `Robin Tester${run}` })).toHaveCount(0); // junior, no email
  await who.getByRole("checkbox", { name: `Send to Sam Tester${run}` }).check();

  const preview = page.getByRole("region", { name: `3. Preview: Gail Group${run}` });
  await expect(preview).toContainText("Hello Gail,");
  await expect(preview).toContainText("Unsubscribe from these emails");
  await expect(preview.locator("img")).toHaveCount(2); // logo and picture
  await shot(page, "group-email");
  await preview.getByRole("button", { name: "Send this as a test to me" }).click();
  await expect(preview.getByText(`Test email sent to ${adminEmail}.`)).toBeVisible();
  expect(mailbox.find((e) => e.to[0] === adminEmail && e.subject === `[Test] Club news ${run}`)?.text).toContain("Hello Gail,");

  const send = page.getByRole("region", { name: "4. Send" });
  await send.getByRole("button", { name: "Send to 2 people" }).click();
  await send.getByRole("button", { name: "Yes, send now" }).click();
  await expect(send.getByText("Sent your email to 2 people.")).toBeVisible();
  const toGail = mailbox.find((e) => e.to[0] === `gail-${run}@example.test`) as SentEmail & { headers?: Record<string, string> };
  expect(toGail.subject).toBe(`Club news ${run}`);
  expect(toGail.html).toContain('alt="Burwain"');
  expect(toGail.html).toMatch(/<img src="http[^"]+\/email-images\//);
  expect(toGail.text).not.toContain("[image:");
  expect(toGail.headers?.["List-Unsubscribe"]).toMatch(/\/unsubscribe\?t=/);
  expect(mailbox.some((e) => e.to[0] === leadEmail && e.text.startsWith("Hello Sam,"))).toBe(true);

  // The Email log lists it; opening it shows the message and who got it.
  await page.getByRole("navigation", { name: "Communications admin" }).getByRole("link", { name: "Email log" }).click();
  await expect(page.getByRole("row", { name: `Club news ${run}` })).toContainText("Group email");
  await page.getByRole("link", { name: `Club news ${run}` }).click();
  await expect(page.getByRole("region", { name: "Sent to (2)" }).getByRole("row", { name: `Gail Group${run}` })).toContainText("Sent");
  await expect(page.getByRole("region", { name: `Club news ${run}` })).toContainText("The clubhouse opens on Saturday.");
  await page.goto("/admin/emails/send");

  // Images can be opened without logging in, as email apps do.
  const imageUrl = toGail.html.match(/<img src="(http[^"]+\/email-images\/[^"]+)"/)![1].replace(/^https?:\/\/[^/]+/, "http://localhost:3100");
  const image = await fetch(imageUrl);
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/png");

  // Gail unsubscribes from the link in the email, without logging in.
  const link = toGail.text.match(/unsubscribe here: (\S+)/)![1].replace(/^https?:\/\/[^/]+/, "");
  const visitor = await browser.newContext({ baseURL: "http://localhost:3100" });
  const v = await visitor.newPage();
  await v.goto(link);
  await v.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(v.getByRole("heading", { name: "You've been unsubscribed" })).toBeVisible();
  await visitor.close();
  expect(sql(`select emails_unsubscribed_at is not null from people where email = 'gail-${run}@example.test'`)).toBe("t");
  await page.reload();
  await page.getByRole("region", { name: /^2\. Choose who gets it/ }).getByPlaceholder("Search by name or email").fill(`Gail Group${run}`);
  await expect(page.getByRole("row", { name: `Gail Group${run}` })).toContainText("Unsubscribed");
});

test("members read the handbook: five sections, a few lines each, expandable, no Edit button", async ({ browser }) => {
  // Long enough text that the preview only shows the first few lines.
  const long = Array.from({ length: 30 }, (_, i) => `<p>Safety line ${i + 1}.</p>`).join("");
  sql(`update handbook_sections set body = '<h3>Pontoons</h3>${long}<p>Last safety line.</p>' where slug = 'safety'`);
  sql(`update handbook_sections set body = '<p>Be kind.</p>' where slug = 'code-of-conduct'`);
  const page = await leadPage(browser);
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Handbook" }).click();
  await expect(page).toHaveURL(/\/handbook$/);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "General Information",
    "Notice of Race",
    "Sailing Instructions",
    "Safety",
    "Code of Conduct",
  ]);
  await expect(page.getByRole("link", { name: /^Edit / })).toHaveCount(0);
  const safety = page.getByRole("region", { name: "Safety" });
  const text = safety.getByTestId("handbook-text");
  const collapsed = (await text.boundingBox())!.height;
  await safety.getByRole("button", { name: "Read all of Safety" }).click();
  await expect(safety.getByRole("button", { name: "Show less of Safety" })).toHaveAttribute("aria-expanded", "true");
  expect((await text.boundingBox())!.height).toBeGreaterThan(collapsed * 2);
  // A short section is shown whole, with no Read more button.
  const coc = page.getByRole("region", { name: "Code of Conduct" });
  await expect(coc).toContainText("Be kind.");
  await expect(coc.getByRole("button")).toHaveCount(0);
  // Members can't open the edit page.
  await page.goto("/handbook/safety/edit");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("an admin edits a handbook section with the Edit button", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto("/handbook");
  const section = page.getByRole("region", { name: "General Information" });
  await section.getByRole("link", { name: "Edit General Information" }).click();
  await expect(page).toHaveURL(/\/handbook\/general-information\/edit$/);
  await expect(page.getByRole("heading", { name: "Edit General Information" })).toBeVisible();
  const box = page.getByRole("textbox", { name: "General Information text" });
  await box.click();
  await page.keyboard.type("Club keys");
  await page.getByRole("button", { name: "Make this line a heading" }).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Make this line normal text" }).click();
  await page.keyboard.type("Keys cost a ");
  await page.getByRole("button", { name: "Bold" }).click();
  await page.keyboard.type("£20 deposit");
  await page.getByRole("button", { name: "Bold" }).click();
  await page.keyboard.type(".");
  // Anything unsafe pasted in is removed when saved.
  await box.evaluate((el) => el.insertAdjacentHTML("beforeend", '<p style="color:red">Ask the <a href="javascript:alert(1)">secretary</a>.</p><script>alert(1)</script>'));
  await page.getByRole("button", { name: "Save section" }).click();
  await expect(page).toHaveURL(/\/handbook\?saved=general-information#general-information$/);
  await expect(page.getByRole("status")).toHaveText("Section saved.");
  await expect(section.getByRole("heading", { name: "Club keys", level: 3 })).toBeVisible();
  await expect(section.locator("strong", { hasText: "£20 deposit" })).toBeVisible();
  const saved = sql(`select body from handbook_sections where slug = 'general-information'`);
  expect(saved).toContain("<h3>Club keys</h3>");
  expect(saved).not.toMatch(/script|javascript|style=/);
  expect(sql(`select p.email from handbook_sections h join people p on p.id = h.updated_by where slug = 'general-information'`)).toBe(adminEmail);
});

test("a member can't open the group email page or the email log", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/emails/send");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
  await page.goto("/admin/emails/log");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
});

test("a member can't open the send reminders page", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/members/remind");
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

test("a member can't open the transactions page", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/admin/transactions");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
  await expect(page.getByText("Money in")).toHaveCount(0);
  await page.goto("/admin/transactions/new");
  await expect(page.getByRole("heading", { name: "Admins only" })).toBeVisible();
  await page.goto("/admin/categories");
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
