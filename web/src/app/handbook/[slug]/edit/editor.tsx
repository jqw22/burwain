import Link from "next/link";
import { RichTextBox } from "@/components/rich-text";
import { SaveButton } from "@/components/save-button";
import { saveHandbookSection } from "../../actions";

// Admins edit a handbook section in a simple word-processor style box.
export function HandbookEditor({ slug, title, html }: { slug: string; title: string; html: string }) {
  return (
    <form action={saveHandbookSection} className="space-y-4" aria-label={`Edit ${title}`}>
      <input type="hidden" name="slug" value={slug} />
      <RichTextBox name="body" label={`${title} text`} html={html} />
      <p className="text-xs text-slate-500">
        Tip: text pasted from Word or a website keeps its headings, lists, links and tables, but fonts and colours are removed when you save.
      </p>
      <div className="flex items-center gap-4">
        <SaveButton>Save section</SaveButton>
        <Link href={`/handbook#${slug}`} className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
          Cancel
        </Link>
      </div>
    </form>
  );
}
