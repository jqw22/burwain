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
test.afterAll(async () => lead?.close());

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test("a member signs in with an email link and sees their membership", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome, Sam" })).toBeVisible();
  await expect(page.getByText(/Family \(\d{4}\/\d{2}\):/)).toBeVisible();
  await expect(page.getByText("Paid")).toBeVisible();
  // The login is now linked to Sam's member record.
  expect(sql(`select auth_user_id is not null from people where email = '${leadEmail}'`)).toBe("t");
  await shot(page, "home");
});

test("a member updates their own details, medical info and qualifications", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/profile");
  await expect(page.getByLabel("First name")).toHaveValue("Sam");

  await page.getByLabel("Mobile", { exact: true }).fill("07700 900123");
  await page.getByLabel("Emergency contact name").fill("Pat Tester");
  await page.getByLabel("I'm happy to be contacted on WhatsApp").check();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByLabel("Mobile", { exact: true })).toHaveValue("07700 900123");
  expect(sql(`select mobile || '|' || whatsapp from people where email = '${leadEmail}'`)).toBe("07700 900123|true");

  await page.getByLabel("Medical details").fill("Mild asthma, inhaler in kit bag.");
  await page.getByLabel("I agree to the club holding this information").check();
  await page.getByRole("button", { name: "Save medical information" }).click();
  await expect(page.getByLabel("Medical details")).toHaveValue("Mild asthma, inhaler in kit bag.");
  expect(sql(`select count(*) from medical_records r join people p on p.id = r.person_id where p.email = '${leadEmail}'`)).toBe("1");

  await page.getByLabel("Qualification").fill("RYA Dinghy Level 2");
  await page.getByLabel("Expires").fill("2028-06-30");
  await page.getByRole("button", { name: "Add qualification" }).click();
  await expect(page.getByText("RYA Dinghy Level 2")).toBeVisible();
  await shot(page, "profile");
});

test("the family lead sees the family and adds a junior", async ({ browser }) => {
  const page = await leadPage(browser);
  await page.goto("/family");
  await expect(page.getByText(`Alex Tester${run}`)).toBeVisible();
  await expect(page.getByText(`Robin Tester${run}`)).toBeVisible();
  await expect(page.getByText("junior, 12")).toBeVisible();

  await page.getByLabel("First name").fill("Charlie");
  await page.getByLabel("Last name").fill(`Tester${run}`);
  await page.getByLabel("Date of birth").fill("2018-04-02");
  await page.getByRole("button", { name: "Add to family" }).click();
  await expect(page.getByText("Family member added.")).toBeVisible();
  await expect(page.getByText(`Charlie Tester${run}`)).toBeVisible();
  await shot(page, "family");
});

test("an email that isn't on the member list gets a clear message", async ({ page }) => {
  await signIn(page, strangerEmail);
  await expect(page.getByRole("heading", { name: "We couldn't find your membership" })).toBeVisible();
});
