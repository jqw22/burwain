import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy notice · Burwain Members" };

// The club's privacy notice (UK GDPR). Public: linked from the footer, Join, login and the medical boxes.
// Wording agreed with the club on 16 November 2026; change the date at the bottom when it is updated.

const PRIVACY_EMAIL = "membership.burwain@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-sky-900">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-300 text-left">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-slate-100 align-top">
              {r.map((c, i) => (
                <td key={i} className={`py-2 pr-4 ${i === 0 ? "font-medium text-slate-900" : "text-slate-700"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PrivacyPage() {
  return (
    <article className="space-y-8 rounded-lg border border-slate-200 bg-white p-6 text-slate-700 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Privacy notice</h1>

      <Section title="1. Who we are">
        <p>
          Burwain Sailing Club (&quot;the club&quot;, &quot;we&quot;) runs this membership website. We decide how your personal information is
          used, which makes us the &quot;data controller&quot; under UK data protection law (UK GDPR and the Data Protection Act 2018).
        </p>
        <p>
          If you have any questions about your information, contact the Membership Secretary at{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="text-sky-800 underline">
            {PRIVACY_EMAIL}
          </a>{" "}
          or write to Burwain Sailing Club, Reedymoor Lane, Foulridge, Colne, Lancashire, BB8 7LJ.
        </p>
      </Section>

      <Section title="2. What information we hold">
        <p>We hold this information about members, family members and people who apply to join:</p>
        <Table
          head={["Type of information", "Examples"]}
          rows={[
            ["Contact details", "Name, title, email address, mobile number, home address and postcode"],
            ["Personal details", "Date of birth (for membership types, age limits and safeguarding)"],
            ["Family group", "Who is in your family group and who the family's main contact is"],
            ["Emergency contact", "Name and mobile number of someone we can call in an emergency"],
            ["Membership", "Membership types, dates, renewals, when you first joined, and your membership history"],
            ["Payments", "Amounts paid, payment dates and method. Card payments are handled by Stripe, and we never see or store your full card number"],
            ["Boats", "Boat class and sail number for boat storage"],
            ["Qualifications", "Sailing and safety qualifications and their expiry dates"],
            ["Medical information", "Only if you choose to give it (see section 4)"],
            ["Preferences", "Whether you get club news by email, use WhatsApp, or appear in the member directory"],
            ["Login and activity", "Your login email, and a record of changes made to member records and who made them"],
          ]}
        />
      </Section>

      <Section title="3. Why we use it, and our legal basis">
        <p>The law requires us to have a &quot;lawful basis&quot; for each way we use your information:</p>
        <Table
          head={["What we use it for", "Lawful basis"]}
          rows={[
            ["Running your membership: joining, renewals, payments, boat storage, renewal reminders", "Contract (your membership agreement with the club)"],
            ["Keeping you safe on the water: emergency contacts, qualifications", "Legitimate interests (running a safe club)"],
            ["Medical information", "Your explicit consent (see section 4)"],
            ["Member directory, so members can contact each other", "Legitimate interests, and you can opt out at any time"],
            ["Club news emails", "Legitimate interests, and you can unsubscribe at any time"],
            ["Keeping financial records", "Legal obligation (accounting and tax rules)"],
            ["Recording who changed member records", "Legitimate interests (keeping the records accurate and secure)"],
          ]}
        />
        <p>We do not sell your information, and we do not use it for advertising.</p>
      </Section>

      <Section title="4. Medical information">
        <p>
          Medical information is optional. We only store it if you tick the consent box when you give it. We ask for it so that safety cover
          and club officers can help you properly if something goes wrong on or off the water.
        </p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Who can see it:</strong> you, your family&apos;s main contact (for family members), and club admins. Finance logins and other
            members cannot see it.
          </li>
          <li>
            <strong>Every view is logged:</strong> each time an admin opens someone&apos;s medical information, the app records who looked and when.
          </li>
          <li>
            <strong>Changing your mind:</strong> you can change or delete it at any time on the Member page, which also withdraws your consent.
            Deleting it removes it from the app straight away.
          </li>
        </ul>
        <p>
          If you give medical information on the Join form, it is held with your application until an admin accepts or declines it. If your
          application is declined, it is deleted.
        </p>
      </Section>

      <Section title="5. Who can see your information inside the club">
        <Table
          head={["Who", "What they can see"]}
          rows={[
            ["You", "Your own details, membership and payments"],
            ["Your family's main contact", "All details of everyone in the family group, including medical information, and they can update them"],
            ["Club admins (about 5 people)", "Member records, so they can run memberships, applications and club emails"],
            ["Finance logins", "Member and payment records for the club accounts, but not medical information"],
            ["Other members, through the Directory", "Name, mobile, email and membership type of adults (18 and over) with a current or upcoming membership"],
            ["Everyone logged in", "The names of club officers, such as the Commodore"],
          ]}
        />
        <p>
          <strong>The member directory:</strong> adults are listed unless they opt out. You can opt out at any time on the Member page. Under-18s
          are never listed.
        </p>
      </Section>

      <Section title="6. Companies that help us run the website">
        <p>We use a few trusted service providers. They only handle your information on our instructions:</p>
        <Table
          head={["Provider", "What they do", "Where"]}
          rows={[
            ["Supabase", "Stores the membership database and handles logins", "London, UK"],
            ["Netlify", "Hosts the website", "Servers worldwide, company in the USA"],
            ["Resend", "Sends club emails and login codes", "USA"],
            ["Stripe", "Takes card payments", "UK/EU and USA"],
            ["GoCardless", "Takes Direct Debit payments", "UK"],
          ]}
        />
        <p>
          Where a provider handles information outside the UK, they use the safeguards UK law requires, such as the UK–US &quot;data bridge&quot;
          or approved contract terms. We may also share information if the law requires it, or with the emergency services if someone&apos;s
          safety is at risk.
        </p>
      </Section>

      <Section title="7. How long we keep it">
        <Table
          head={["Information", "How long"]}
          rows={[
            ["Current members", "For as long as you are a member"],
            [
              "Former (lapsed) members",
              "5 years after your last membership ends, so we can invite you back, unless you ask us to delete it sooner. You can unsubscribe from club emails at any time",
            ],
            ["Medical information", "Until you delete it, or until your membership record is deleted"],
            ["Join applications", "Until accepted or declined. Declined applications keep only a name, email and reason"],
            ["Payment and financial records", "6 years, as accounting rules require"],
            ["Record of changes to member records", "6 years"],
          ]}
        />
      </Section>

      <Section title="8. Club emails">
        <p>We send two kinds of email:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            <strong>Service emails</strong> about your membership, such as login codes, renewal reminders and payment confirmations. You get these
            while you have a membership with us.
          </li>
          <li>
            <strong>Club news</strong> sent to groups of members. Every club news email has an unsubscribe link. You can also turn club news off
            on the Member page.
          </li>
        </ul>
      </Section>

      <Section title="9. Your rights">
        <p>You have the right to:</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>see a copy of the information we hold about you</li>
          <li>have wrong or incomplete information corrected (you can do most of this yourself on the Member page)</li>
          <li>have your information deleted, unless we must keep it, for example payment records</li>
          <li>object to how we use it, or ask us to limit it</li>
          <li>withdraw your consent for medical information at any time</li>
          <li>get a copy of your information in a format you can take elsewhere</li>
        </ul>
        <p>
          To use any of these rights, contact{" "}
          <a href={`mailto:${PRIVACY_EMAIL}`} className="text-sky-800 underline">
            {PRIVACY_EMAIL}
          </a>
          . We will reply within one month.
        </p>
        <p>
          If you&apos;re unhappy with how we&apos;ve handled your information, please tell us first. You can also complain to the Information
          Commissioner&apos;s Office (ICO) at{" "}
          <a href="https://ico.org.uk/make-a-complaint/" className="text-sky-800 underline">
            ico.org.uk/make-a-complaint
          </a>{" "}
          or on 0303 123 1113.
        </p>
      </Section>

      <Section title="10. Children and junior members">
        <p>
          Junior members&apos; details are given and managed by their parent or guardian, who is the family&apos;s main contact. Under-18s cannot
          log in to the website and are never shown in the member directory. Club news emails are never sent to junior members.
        </p>
      </Section>

      <Section title="11. Changes to this notice">
        <p>
          We may update this notice from time to time, and the latest version will always be on this page. If we make an important change,
          we&apos;ll tell members by email.
        </p>
        <p>Last updated: 16 November 2026</p>
      </Section>
    </article>
  );
}
