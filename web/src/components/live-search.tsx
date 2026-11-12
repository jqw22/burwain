"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

// A search box that updates the results as you type (no Search button).
// It keeps the page's other settings (filters, sort) in the address.
export function LiveSearch({ label, placeholder, initial }: { label: string; placeholder: string; initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const first = useRef(true);

  // Follow the address when it changes from elsewhere (for example "Clear search"), unless the box is being typed in.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    if (typeof document !== "undefined" && document.activeElement?.id !== "q") setValue(initial);
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      const s = next.toString();
      startTransition(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
    }, 300);
    return () => clearTimeout(timer);
    // Only re-run when the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <form role="search" className="relative" onSubmit={(e) => e.preventDefault()}>
      <label className="sr-only" htmlFor="q">
        {label}
      </label>
      <input
        id="q"
        name="q"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded border border-slate-300 bg-white px-3 py-2"
      />
      {pending && (
        <span className="pointer-events-none absolute right-9 top-2.5 text-xs text-slate-500" aria-live="polite">
          Searching…
        </span>
      )}
    </form>
  );
}
