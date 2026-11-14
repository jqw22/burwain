import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { Card, Checkbox, Field, SaveButton } from "@/components/fields";
import { meWithRole } from "@/lib/me";
import { addContact } from "./actions";

const ERRORS: Record<string, string> = {
  admin: "Only club admins can add contacts.",
  name: "Please give a first and last name.",
  noemail: "Please give an email address. Contacts are for the club's email lists.",
  email: "Someone on the list already uses that email.",
  save: "We couldn't add that contact. Please try again.",
};

// Club admins add people who aren't members, for the club's email lists.
export default async function AddContactPage({ searchParams }: PageProps<"/admin/contacts/new">) {
  const params = await searchParams;
  const { allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <div className="space-y-6">
      <AdminNav current="contacts" />
      <p className="text-slate-700">
        For people who aren&apos;t members but should get club emails. They don&apos;t get a membership and aren&apos;t shown in the
        member directory. If they join later, add their membership from their page.
      </p>
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-red-800" role="alert">
          {error}
        </p>
      )}
      <Card title="Contact details">
        <form action={addContact} className="grid gap-4 sm:grid-cols-2" aria-label="Add a contact">
          <Field label="First name" name="first_name" required />
          <Field label="Last name" name="last_name" required />
          <Field label="Email" name="email" type="email" required />
          <Field label="Mobile" name="mobile" />
          <div className="sm:col-span-2">
            <Checkbox label="They've agreed to receive club news by email" name="news_consent" defaultChecked />
          </div>
          <div className="flex items-center gap-4 sm:col-span-2">
            <SaveButton>Add contact</SaveButton>
            <Link href="/admin" className="text-sm text-slate-600 underline">
              Cancel
            </Link>
          </div>
        </form>
      </Card>
    </div>
  );
}
