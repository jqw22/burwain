"use client";

import { useFormStatus } from "react-dom";

const STYLES = {
  // Solid button: darkens with a ring on hover, presses in when clicked, greys out while saving.
  primary:
    "inline-flex items-center gap-2 rounded bg-sky-800 px-4 py-2 font-medium text-white shadow-sm transition " +
    "hover:bg-sky-950 hover:ring-2 hover:ring-sky-300 hover:ring-offset-1 active:translate-y-px active:bg-sky-950 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 " +
    "disabled:cursor-wait disabled:bg-slate-400 disabled:ring-0",
  secondary:
    "inline-flex items-center gap-2 rounded border border-slate-400 bg-white px-4 py-2 font-medium text-slate-800 transition " +
    "hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900 active:translate-y-px " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 " +
    "disabled:cursor-wait disabled:opacity-60",
  link:
    "inline-flex items-center gap-1 rounded px-1 text-sm text-slate-600 underline underline-offset-2 transition " +
    "hover:bg-slate-100 hover:text-sky-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 " +
    "disabled:cursor-wait disabled:opacity-60",
} as const;

export function SaveButton({
  children = "Save",
  variant = "primary",
  pendingText = "Saving…",
  ...rest
}: {
  children?: React.ReactNode;
  variant?: keyof typeof STYLES;
  pendingText?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className" | "children">) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={STYLES[variant]} {...rest}>
      {pending && (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {pending ? pendingText : children}
    </button>
  );
}
