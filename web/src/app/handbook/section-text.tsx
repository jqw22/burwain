"use client";

import { useEffect, useRef, useState } from "react";

// Shows the first few lines of a section with a fade, and a button to expand it to full length.
// Short sections that fit in the preview are shown whole, with no button.
export function SectionText({ title, html, startOpen = false }: { title: string; html: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [overflows, setOverflows] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 4);
  }, [html, open]);

  const collapsed = !open && overflows;
  return (
    <div className="mt-3">
      <div
        ref={box}
        className={`handbook-text relative ${open ? "" : "max-h-36 overflow-hidden"}`}
        data-testid="handbook-text"
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {collapsed && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white" />}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? "Show less of" : "Read all of"} ${title}`}
          className="mt-3 rounded px-1 text-sm font-medium text-sky-800 underline underline-offset-2 hover:bg-sky-50 hover:text-sky-950"
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
