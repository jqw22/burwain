import Link from "next/link";
import { notFound } from "next/navigation";
import { NotAllowed } from "@/components/admin";
import { cleanHandbookHtml } from "@/lib/handbook";
import { meWithRole, ukDate } from "@/lib/me";
import { HandbookEditor } from "./editor";

// Admins edit one handbook section's text.
export default async function EditHandbookSectionPage({ params, searchParams }: PageProps<"/handbook/[slug]/edit">) {
  const { slug } = await params;
  const { error } = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;

  const { data: section } = await supabase
    .from("handbook_sections")
    .select("slug, title, body, updated_at, editor:people!handbook_sections_updated_by_fkey(first_name, last_name)")
    .eq("slug", slug)
    .maybeSingle();
  if (!section) notFound();
  const editor = section.editor as unknown as { first_name: string; last_name: string } | null;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/handbook#${section.slug}`} className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
          ← Back to Handbook
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit {section.title}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Last changed {ukDate(section.updated_at)}
          {editor ? ` by ${editor.first_name} ${editor.last_name}` : ""}. Everyone who is signed in can read this section.
        </p>
      </div>
      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
          Sorry, the section could not be saved. Please try again.
        </p>
      )}
      <HandbookEditor slug={section.slug} title={section.title} html={cleanHandbookHtml(section.body)} />
    </div>
  );
}
