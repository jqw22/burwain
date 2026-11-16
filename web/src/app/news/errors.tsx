const MESSAGES: Record<string, string> = {
  title: "Please give the post a title.",
  body: "Please write something in the post.",
  save: "Sorry, the post could not be saved. Please try again.",
  delete: "Sorry, the post could not be deleted. Please try again.",
};

export function NewsError({ error }: { error?: string | string[] }) {
  const key = Array.isArray(error) ? error[0] : error;
  if (!key) return null;
  return (
    <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
      {MESSAGES[key] ?? MESSAGES.save}
    </p>
  );
}
