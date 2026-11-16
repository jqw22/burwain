const MESSAGES: Record<string, string> = {
  type: "Please choose the type of event.",
  title: "Please give the event a title.",
  date: "Please choose the date.",
  time: "Please choose the start time.",
  save: "Sorry, the event could not be saved. Please try again.",
  dutysave: "The event was saved, but a duty could not be filled. Please check it and try again.",
  delete: "Sorry, the event could not be deleted. Please try again.",
  past: "Sorry, that event has already happened.",
  taken: "Sorry, someone has just taken that duty.",
  gone: "Sorry, that event is no longer on the calendar.",
  duty: "Sorry, only adult members can take a duty, and only for themselves.",
  signup: "Sorry, that didn't work. You can put down yourself, or your family if you are its main contact.",
};

export function CalendarError({ error }: { error?: string | string[] }) {
  const key = Array.isArray(error) ? error[0] : error;
  if (!key) return null;
  return (
    <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
      {MESSAGES[key] ?? MESSAGES.save}
    </p>
  );
}
