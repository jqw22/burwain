"use client";

// Opens the browser's print dialog (which can also save as PDF).
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 transition hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900 print:hidden"
    >
      <span aria-hidden="true">🖨</span>
      {label}
    </button>
  );
}
