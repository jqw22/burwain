type InputProps = {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
};

export function Field({ label, name, defaultValue, type = "text", required, autoComplete, hint }: InputProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        defaultValue={defaultValue ?? ""}
        className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Checkbox({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-start gap-2">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="mt-1" />
      <span className="text-sm">{label}</span>
    </label>
  );
}

export function Card({
  title,
  children,
  action,
  id,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export { SaveButton } from "./save-button";

export function Notice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 p-3 font-medium text-emerald-900" role="status">
      <span aria-hidden="true">✓</span>
      {message}
    </p>
  );
}
