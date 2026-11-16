// Shared bits for the club calendar (the Calendar page and the Home "Coming up" box).

export type EventType = "sailing" | "meeting" | "training" | "other";
export type DutyRole = "officer" | "assistant" | "trainer";

export type CalendarEvent = {
  id: string;
  event_type: EventType;
  title: string;
  event_date: string; // YYYY-MM-DD
  start_time: string; // HH:MM:SS
};

// One row from calendar_people(): a duty holder or someone going. Hidden people have no id or name.
export type EventPerson = {
  event_id: string;
  kind: DutyRole | "attending";
  person_id: string | null;
  first_name: string | null;
  last_name: string | null;
};

export const EVENT_TYPES: { value: EventType; label: string; plural: string; badge: string }[] = [
  { value: "sailing", label: "Sailing", plural: "Sailing", badge: "bg-sky-100 text-sky-900" },
  { value: "meeting", label: "Meeting", plural: "Meetings", badge: "bg-amber-100 text-amber-900" },
  { value: "training", label: "Training", plural: "Training", badge: "bg-green-100 text-green-900" },
  { value: "other", label: "Other", plural: "Other", badge: "bg-slate-100 text-slate-800" },
];
export const typeInfo = (t: string) => EVENT_TYPES.find((x) => x.value === t) ?? EVENT_TYPES[3];

// The duties each type of event needs (the database checks the same rule).
export const DUTIES: Record<EventType, { role: DutyRole; label: string }[]> = {
  sailing: [
    { role: "officer", label: "Officer" },
    { role: "assistant", label: "Assistant" },
  ],
  training: [{ role: "trainer", label: "Trainer" }],
  meeting: [],
  other: [],
};

// "10:00"
export const startTime = (t: string) => t.slice(0, 5);

const at = (iso: string) => new Date(`${iso}T12:00:00`);
// "Sat 21 Nov"
export const shortDate = (iso: string) =>
  `${at(iso).toLocaleDateString("en-GB", { weekday: "short" })} ${at(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
// "November 2026"
export const monthHeading = (iso: string) => at(iso).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
export const weekday = (iso: string) => at(iso).toLocaleDateString("en-GB", { weekday: "short" });
export const dayOfMonth = (iso: string) => at(iso).getDate();
export const monthShort = (iso: string) => at(iso).toLocaleDateString("en-GB", { month: "short" });

// "Sam Smith, Alex Smith and 2 others"
export function nameList(names: string[], hidden: number) {
  const parts = [...names];
  if (hidden > 0) parts.push(`${hidden} other${hidden === 1 ? "" : "s"}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
