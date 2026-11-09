import { execFileSync } from "node:child_process";
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

async function latestLink(email: string) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string };
      const link = msg.Text.match(/https?:\/\/\S+\/auth\/v1\/verify\S+/)?.[0];
      if (link) return link.replace(/[)\]>]+$/, "");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no login email arrived for ${email}`);
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a login link" }).click();
  await expect(page.getByText("Check your email for a login link")).toBeVisible();
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
    await signIn(await admin.newPage(), adminEmail);
  }
  const page = await admin.newPage();
  await page.goto("/");
  return page;
}
test.afterAll(async () => {
  await lead?.close();
  await admin?.close();
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
  await page.getByRole("button", { name: `Renew for ${next}` }).click();
  await expect(page.getByText("Renewed.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Your membership" }).getByText(/Family for Sam, Alex, Robin: £255\s*Awaiting payment/)).toBeVisible();
  await expect(page.getByRole("button", { name: `Renew for ${next}` })).toHaveCount(0);
  expect(
    sql(`select count(*) from memberships m join club_years cy on cy.id = m.club_year_id join people p on p.id = m.payer_person_id
         where p.email = '${leadEmail}' and cy.label = '${next}' and m.status = 'awaiting_payment'`),
  ).toBe("1");
  await shot(page, "renew-after");
});

test("an admin imports the member spreadsheet after checking a preview", async ({ browser }) => {
  const page = await adminPage(browser);
  // Import is no longer on the home page; it is in the admin menu.
  await page.getByRole("link", { name: "Members", exact: true }).click();
  await page.getByRole("link", { name: "Import spreadsheet" }).click();
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
  await expect(page.getByRole("row", { name: new RegExp(`Tester${run}, Sam`) })).toContainText("F: Paid");
  await shot(page, "admin-members");

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
  await page.getByRole("link", { name: "Memberships and payments" }).click();
  await expect(page.getByRole("heading", { name: "Memberships and payments" })).toBeVisible();
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
  await page.getByRole("link", { name: "Add new member" }).click();
  await page.waitForLoadState("networkidle");
  const form = page.getByRole("form", { name: "Add new member" });
  await form.getByLabel("First name").fill("Charlie");
  await form.getByLabel("Last name").fill(`Tester${run}`);
  await form.getByLabel("Date of birth").fill("2018-04-02");
  await form.getByLabel("Joining a family already in the club").check();
  const familyLabel = await form.getByLabel("Which family?").locator("option", { hasText: `Tester${run}, Sam` }).textContent();
  await form.getByLabel("Which family?").selectOption({ label: familyLabel! });
  await form.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText("New member added.")).toBeVisible();
  expect(
    sql(`select count(*) from membership_people mp join people p on p.id = mp.person_id
          join memberships m on m.id = mp.membership_id join membership_types t on t.id = m.membership_type_id
         where p.first_name = 'Charlie' and p.last_name = 'Tester${run}' and t.code = 'F' and m.club_year_id = current_club_year_id()`),
  ).toBe("1");

  // Nora starts a new family on Club Membership and pays cash. A missing postcode is explained first.
  await page.goto("/admin/members/new");
  await page.waitForLoadState("networkidle");
  await form.getByLabel("First name").fill("Nora");
  await form.getByLabel("Last name").fill(`New${run}`);
  await form.getByLabel(/^Email/).fill(`nora-${run}@example.test`);
  await form.getByLabel("Address line 1").fill("7 Harbour St");
  await form.getByLabel("Postcode").fill("bb11 3dd");
  await form.getByLabel("Club year").selectOption({ index: 0 });
  const typeLabel = await form.getByLabel("Membership type").locator("option", { hasText: /^Club Membership: £/ }).textContent();
  await form.getByLabel("Membership type").selectOption({ label: typeLabel! });
  await form.getByLabel("Payment received").selectOption("cash");
  await form.getByLabel("Medical details").fill("Type 1 diabetes.");
  await form.getByLabel(/agrees to the club holding this information/).check();
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
  expect(
    sql(`select m.status from memberships m join membership_people mp on mp.membership_id = m.id
          join people p on p.id = mp.person_id where p.email = 'nora-${run}@example.test'`),
  ).toBe("active");
  expect(
    sql(`select r.details, q.name, q.expires_on, p.news_consent from people p
           join medical_records r on r.person_id = p.id join qualifications q on q.person_id = p.id
          where p.email = 'nora-${run}@example.test'`),
  ).toBe("Type 1 diabetes.|RYA Powerboat Level 2|2029-05-01|t");

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
  await form.getByLabel("First name").fill("Nora");
  await form.getByLabel("Last name").fill(`Again${run}`);
  await form.getByLabel(/^Email/).fill(`nora-${run}@example.test`);
  await form.getByLabel("Address line 1").fill("7 Harbour St");
  await form.getByLabel("Postcode").fill("bb11 3dd");
  await form.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByText(`Someone already uses nora-${run}@example.test.`)).toBeVisible();
  await expect(form.getByLabel("Last name")).toHaveValue(`Again${run}`);
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
  await shot(page, "directory");
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
  await signIn(page, strangerEmail);
  await expect(page.getByRole("heading", { name: "We couldn't find your membership" })).toBeVisible();
});
