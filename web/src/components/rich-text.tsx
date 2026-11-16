"use client";

import { useEffect, useRef } from "react";
import { ImageButton } from "@/components/image-button";

// A simple word-processor style box: type straight into the text, and use the buttons for headings,
// bold, lists and links (and pictures, where allowed). The formatted text goes into a hidden form field.
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

export function RichTextBox({
  name,
  label,
  html,
  images = false,
  minHeight = "min-h-96",
}: {
  name: string;
  label: string;
  html: string;
  images?: boolean;
  minHeight?: string;
}) {
  const area = useRef<HTMLDivElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  // Where the cursor was, so a picture lands there even after the file chooser takes the focus away.
  const saved = useRef<Range | null>(null);

  const sync = () => {
    if (hidden.current && area.current) hidden.current.value = area.current.innerHTML;
  };
  // Copy the text into the form just before it's sent too (the form reads it before React does).
  useEffect(() => {
    const form = area.current?.closest("form");
    if (!form) return;
    const onSubmit = () => {
      if (hidden.current && area.current) hidden.current.value = area.current.innerHTML;
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, []);
  const remember = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && area.current?.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };
  // execCommand is old but still the simplest way to format text inside an editable box in every browser.
  const exec = (command: string, value?: string) => {
    area.current?.focus();
    document.execCommand(command, false, value);
    sync();
  };
  const run = (t: Tool) => {
    if (t.command !== "createLink") return exec(t.command, t.value);
    const url = window.prompt("Web address for the link (for example https://www.burwain.co.uk)");
    if (!url) return;
    exec("createLink", /^(https?:|mailto:|tel:)/i.test(url) ? url : `https://${url}`);
  };
  const insertImage = (url: string) => {
    const el = area.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (saved.current && sel) {
      sel.removeAllRanges();
      sel.addRange(saved.current);
    } else if (sel) {
      // No cursor yet: put the picture at the end.
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand("insertHTML", false, `<p><img src="${url.replace(/"/g, "&quot;")}" alt=""></p><p><br></p>`);
    sync();
  };

  return (
    <div className="rounded-lg border border-slate-300 bg-white shadow-sm">
      <input type="hidden" name={name} ref={hidden} defaultValue={html} />
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-2">
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
        {images && <ImageButton onUploaded={insertImage} />}
      </div>
      <div
        ref={area}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        onInput={sync}
        onBlur={() => {
          remember();
          sync();
        }}
        onKeyUp={remember}
        onMouseUp={remember}
        className={`handbook-text ${minHeight} p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
