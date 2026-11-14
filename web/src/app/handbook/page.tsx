import Link from "next/link";
import { Card } from "@/components/fields";
import { handbookHtmlForDisplay, type HandbookSection } from "@/lib/handbook";
import { meWithRole } from "@/lib/me";
import { SectionText } from "./section-text";

// The club handbook: one full-width box per section showing the first few lines, which members can
// expand to read in full. Admins get an Edit button on each section.
export default async function HandbookPage({ searchParams }: PageProps<"/handbook">) {
  const { saved } = await searchParams;
  const { supabase, allowed: isAdmin } = await meWithRole("admin");
  const { data } = await supabase.from("handbook_sections").select("slug, title, body, updated_at").order("position");
  const sections = (data ?? []) as HandbookSection[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Handbook</h1>
      {saved && (
        <p className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900" role="status">
          Section saved.
        </p>
      )}
      {sections.map((s) => (
        <Card
          key={s.slug}
          id={s.slug}
          title={s.title}
          action={
            isAdmin ? (
              <Link
                href={`/handbook/${s.slug}/edit`}
                aria-label={`Edit ${s.title}`}
                className="rounded border border-slate-400 px-3 py-1 text-sm font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900"
              >
                Edit
              </Link>
            ) : undefined
          }
        >
          {s.body.trim() ? (
            <SectionText title={s.title} html={handbookHtmlForDisplay(s.body)} startOpen={saved === s.slug} />
          ) : (
            <p className="text-slate-500">Nothing written yet.</p>
          )}
        </Card>
      ))}
    </div>
  );
}
