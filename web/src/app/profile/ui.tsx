import Link from "next/link";
import { SaveButton } from "@/components/fields";

export const LINK =
  "rounded px-1 text-sm text-sky-800 underline underline-offset-2 hover:bg-sky-50 hover:text-sky-950 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500";

export function EditLink({ section, label, text = "Edit" }: { section: string; label: string; text?: string }) {
  return (
    <Link
      href={`/profile?edit=${section}#${section}`}
      scroll={false}
      className={LINK}
      aria-label={text === "Edit" ? `Edit ${label}` : undefined}
    >
      {text}
    </Link>
  );
}

export function FormButtons({
  section,
  children,
  cancelText = "Cancel",
  wide,
}: {
  section: string;
  children: React.ReactNode;
  cancelText?: string;
  wide?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 ${wide ? "sm:col-span-3" : "sm:col-span-2"}`}>
      <SaveButton>{children}</SaveButton>
      <Link href={`/profile#${section}`} scroll={false} className={LINK}>
        {cancelText}
      </Link>
    </div>
  );
}

export function Item({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value || "Not given"}</dd>
    </div>
  );
}
