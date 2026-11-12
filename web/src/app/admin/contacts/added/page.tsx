import Link from "next/link";
import { AdminNav, NotAllowed } from "@/components/admin";
import { meWithRole } from "@/lib/me";

// Shown after an admin adds a contact: a simple confirmation with what to do next.
export default async function ContactAddedPage({ searchParams }: PageProps<"/admin/contacts/added">) {
  const params = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;
  const id = typeof params.id === "string" ? params.id : null;
  const { data: person } = id
    ? await supabase.from("people").select("first_name, last_name, email").eq("id", id).maybeSingle()
    : { data: null };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Contact added</h1>
      <AdminNav current="members" />
      <div className="rounded border border-green-300 bg-green-50 p-4 text-green-900" role="status">
        {person ? (
          <p>
            <strong>
              {person.first_name} {person.last_name}
            </strong>
            {person.email ? ` (${person.email})` : ""} has been added to the club&apos;s email list.
          </p>
        ) : (
          <p>The contact has been added to the club&apos;s email list.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/admin/contacts/new" className="rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-950">
          Add another contact
        </Link>
        <Link href="/" className="text-sm text-slate-600 underline">
          Back to Admin
        </Link>
      </div>
    </div>
  );
}
