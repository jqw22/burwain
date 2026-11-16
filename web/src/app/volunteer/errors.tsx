const MESSAGES: Record<string, string> = {
  title: "Please give the job a title.",
  helpers: "Helpers needed must be a whole number, or left blank for no limit.",
  save: "Sorry, the job could not be saved. Please try again.",
  delete: "Sorry, the job could not be deleted. Please try again.",
  full: "Sorry, that job already has all the helpers it needs.",
  closed: "Sorry, that job is no longer open.",
  signup: "Sorry, that didn't work. You can put down yourself, or your family if you are its main contact.",
};

export function VolunteerError({ error }: { error?: string | string[] }) {
  const key = Array.isArray(error) ? error[0] : error;
  if (!key) return null;
  return (
    <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
      {MESSAGES[key] ?? MESSAGES.save}
    </p>
  );
}
