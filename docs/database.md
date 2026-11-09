# Burwain membership app: database (step 2)

Supabase database design for the membership app. The spec is the
"Membership App spec" doc: https://claude.ai/artifact/HdjVuJm3X2TirunfGKSbos

## Files

| File | What it does |
| --- | --- |
| `../supabase/migrations/20261108000001_initial_schema.sql` | Tables: people, households, roles, medical records, qualifications, membership types, club years, memberships, boat storage, payments, finance ledger, email, change log |
| `../supabase/migrations/20261108000002_security.sql` | Row-level security for member / finance / admin / superadmin, pricing and approval functions, payment-to-ledger automation, reporting views, change log triggers |
| `../supabase/seed.sql` | The 11 membership types and prices, boat storage rates, club years 2026/27 and 2027/28, finance categories |

All money is stored in pence. The club year runs 1 March to the end of February.

## How it fits together

- **people** each have their own record; adults get a login (`auth_user_id`). A **household** groups a family and has a lead contact.
- **user_roles** gives extra powers: `finance`, `admin`, `superadmin`. Superadmin passes every role check.
- **memberships** are one per type per club year, covering one or more people via **membership_people**. Members create them only through `start_membership(type, people, club year)`. It prices from today's date (`club_today()`): full price before the year starts or in March, then monthly pro rata. Members can buy for the current year, or for next year once renewals open 60 days before 1 March (`open_club_years()`). It checks age limits and household rules, requires an adult member before a junior, picks junior sibling pricing (J1, J2, J3) automatically, stops anyone holding the same type or two sailing memberships in a year, and puts Associate applications into `pending_approval`. `membership_quote()` shows prices, and `cancel_my_membership()` cancels an unpaid one.
- **payments** and **payment_lines** record what was paid for. When a payment is marked `paid`, the memberships/boat storage it covers become `active` and income lines (plus any Stripe/GoCardless fee as a cost) are posted to **transactions** automatically.
- **medical_records** are visible to the member; admins read them only through `get_medical_record()`, which logs every view in **medical_access_log**.

## Report functions for the app

Called from the app as RPCs, e.g. `supabase.rpc('member_directory')`.

| Function | Who | Shows |
| --- | --- | --- |
| `member_directory()` | any member | Name, phone, email of current adult members who haven't opted out |
| `membership_history()` | member (own household), finance, admin | Each year's type, price, payment and linked income transaction |
| `finance_member_status()` | finance, admin | Names, membership type and payment status (no personal details) |
| `income_statement()` | finance, admin | Totals by club year, category and membership type |
| `qualifications_expiring()` | admin | Qualifications expiring in the next 60 days |

## Spreadsheet import mapping

Admins upload the spreadsheet at `/admin/import` in the app. It shows a preview grouped into families, then calls `import_members()`, which adds everything in one go (or nothing, if anything fails) and skips people already in the database (same name and date of birth, or same first name and email). The oldest adult in each family becomes its main contact. Family and Dual memberships cover everyone at the address with that class; other types are one per person.

| Spreadsheet column | Goes to |
| --- | --- |
| Firstname, Lastname, Title | `people.first_name`, `last_name`, `title` |
| DOB | `people.date_of_birth` |
| Address1 to Address4, Post Code | `households.address_line1..4`, `postcode` (people at the same address are proposed as one household for an admin to confirm) |
| Email | `people.email` (becomes the login for adults) |
| Mobile | `people.mobile` |
| WhatsApp (Y/N) | `people.whatsapp` |
| Emergency Contact Name / Mobile | `people.emergency_contact_name`, `emergency_contact_mobile` |
| Member Class | a 2026/27 `memberships` row of that type, marked `active` |

To fill in once after import: first joined date, household groupings, who has paid this year, and club news consent.

## Tested

Loaded into a local Postgres 16 with Supabase's `auth` schema stubbed, then exercised as each role:
member pricing and pro rata (September join = 6/12), junior/adult rule, age limits, household limits,
blocked direct inserts and admin-field edits, Associate approval, finance payment posting to the income
statement, medical access and logging, superadmin-only change log, directory opt-out and adults-only.

## Applying to Supabase

Create the project in the **London (eu-west-2)** region, then run the two migrations and the seed in
order (Supabase CLI: `supabase db push`, or paste into the SQL editor). Give the first superadmin their
role by inserting into `user_roles` from the SQL editor.

## Automatic tests

`supabase/tests/run.sh` loads the migrations and seed into an empty Postgres (with a small stand-in for
Supabase's `auth` schema) and runs `supabase/tests/roles_test.sql`, which acts as each role and checks
prices, pro rata, household and age rules, approvals, payment posting, medical privacy, the directory and
signed-out access. GitHub runs it on every pull request and on `main` (`.github/workflows/database-tests.yml`).
