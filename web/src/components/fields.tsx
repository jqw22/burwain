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

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SaveButton({ children = "Save" }: { children?: React.ReactNode }) {
  return (
    <button type="submit" className="rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-900">
      {children}
    </button>
  );
}

export function Notice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="rounded bg-emerald-50 p-3 text-emerald-900" role="status">
      {message}
    </p>
  );
}
