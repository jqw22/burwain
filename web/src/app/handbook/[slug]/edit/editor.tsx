"use client";

import Link from "next/link";
import { useRef } from "react";
import { SaveButton } from "@/components/save-button";
import { saveHandbookSection } from "../../actions";

// A simple word-processor style box: type straight into the text, and use the buttons for headings,
// bold, lists and links. The formatting is saved with the text.
type Tool = { label: string; title: string; command: string; value?: string; className?: string };

const TOOLS: Tool[] = [
  { label: "Heading", title: "Make this line a heading", command: "formatBlock", value: "<h3>", className: "font-semibold" },
  { label: "Sub-heading", title: "Make this line a smaller heading", command: "formatBlock", value: "<h4>" },
  { label: "Normal text", title: "Make this line normal text", command: "formatBlock", value: "<p>" },
  { label: "B", title: "Bold", command: "bold", className: "font-bold" },
  { label: "I", title: "Italic", command: "italic", className: "italic" },
  { label: "U", title: "Underline", command: "underline", className: "underline" },
  { label: "• List", title: "Bulleted list", command: "insertUnorderedList" },
  { label: "1. List", title: "Numbered list", command: "insertOrderedList" },
  { label: "Link", title: "Turn the selected words into a link", command: "createLink" },
  { label: "Remove link", title: "Remove the link from the selected words", command: "unlink" },
];

export function HandbookEditor({ slug, title, html }: { slug: string; title: string; html: string }) {
  const area = useRef<HTMLDivElement>(null);
  const hidden = useRef<HTMLInputElement>(null);

  // execCommand is old but still the simplest way to format text inside an editable box in every browser.
  const exec = (command: string, value?: string) => {
    area.current?.focus();
    document.execCommand(command, false, value);
  };
  const run = (t: Tool) => {
    if (t.command !== "createLink") return exec(t.command, t.value);
    const url = window.prompt("Web address for the link (for example https://www.burwain.co.uk)");
    if (!url) return;
    exec("createLink", /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}`);
  };

  return (
    <form
      action={saveHandbookSection}
      onSubmit={() => {
        if (hidden.current && area.current) hidden.current.value = area.current.innerHTML;
      }}
      className="space-y-4"
      aria-label={`Edit ${title}`}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="body" ref={hidden} defaultValue={html} />
      <div className="rounded-lg border border-slate-300 bg-white shadow-sm">
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 p-2">
          {TOOLS.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.title}
              aria-label={t.title}
              // Keep the text selection when a button is clicked.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(t)}
              className={`rounded border border-slate-300 bg-white px-2.5 py-1 text-sm text-slate-800 hover:border-sky-800 hover:bg-sky-50 ${t.className ?? ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          ref={area}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={`${title} text`}
          className="handbook-text min-h-96 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
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
