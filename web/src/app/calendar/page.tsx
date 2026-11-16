import Link from "next/link";
import { Notice } from "@/components/fields";
import { SaveButton } from "@/components/save-button";
import {
  DUTIES,
  EVENT_TYPES,
  dayOfMonth,
  monthHeading,
  monthShort,
  nameList,
  startTime,
  typeInfo,
  weekday,
  type CalendarEvent,
  type EventPerson,
} from "@/lib/calendar";
import { meWithRole } from "@/lib/me";
import { ukToday } from "@/lib/quote";
import { toggleAttending, toggleDuty } from "./actions";
import { CalendarError } from "./errors";

type Helper = { id: string; first_name: string; last_name: string; is_me: boolean };

const NOTICES: Record<string, string> = { saved: "Event saved.", deleted: "Event deleted." };

const fullName = (p: EventPerson) => `${p.first_name} ${p.last_name}`;

// The club calendar as an agenda: events listed by date under month headings. Members say who is
// going with the + buttons (themselves, or their family if they are its main contact) and adults can
// take an empty Officer, Assistant or Trainer duty. Admins add, edit and delete events.
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const past = one(params.past) === "1";
  const type = EVENT_TYPES.find((t) => t.value === one(params.type))?.value;
  const { supabase, personId, allowed: isAdmin } = await meWithRole("admin");

  // Upcoming: today onwards, soonest first. Past: the last 12 months, most recent first.
  const today = ukToday();
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const from = past ? yearAgo : today;
  const to = past ? today : "9999-12-31";
  let query = supabase
    .from("calendar_events")
    .select("id, event_type, title, event_date, start_time")
    .gte("event_date", from)
    .order("event_date", { ascending: !past })
    .order("start_time", { ascending: !past });
  query = past ? query.lt("event_date", today) : query;
  if (type) query = query.eq("event_type", type);

  const [{ data: eventData }, { data: peopleData }, { data: helperData }] = await Promise.all([
    query,
    supabase.rpc("calendar_people", { p_from: from, p_to: to }),
    supabase.rpc("my_volunteer_people"),
  ]);
  const events = (eventData ?? []) as CalendarEvent[];
  const people = (peopleData ?? []) as EventPerson[];
  const helpers = (helperData ?? []) as Helper[];
  const meAdult = helpers.some((h) => h.is_me);

  // Group by month, keeping the order above.
  const months: { heading: string; events: CalendarEvent[] }[] = [];
  for (const e of events) {
    const heading = monthHeading(e.event_date);
    if (months.at(-1)?.heading !== heading) months.push({ heading, events: [] });
    months.at(-1)!.events.push(e);
  }

  const view = new URLSearchParams();
  if (type) view.set("type", type);
  if (past) view.set("past", "1");
  const viewString = view.toString();
  const link = (t: string | undefined, p: boolean) => {
    const q = new URLSearchParams();
    if (t) q.set("type", t);
    if (p) q.set("past", "1");
    const s = q.toString();
    return `/calendar${s ? `?${s}` : ""}`;
  };
  const notice = Object.keys(NOTICES).find((k) => params[k]);
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1 text-sm font-medium ${
      on ? "border-sky-800 bg-sky-800 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-sky-800 hover:text-sky-900"
    }`;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">{past ? "Calendar: past events" : "Calendar"}</h1>
        {isAdmin && (
          <Link href="/calendar/new" className="rounded bg-sky-800 px-4 py-2 text-sm font-medium text-white hover:bg-sky-950">
            + Add event
          </Link>
        )}
      </div>
      <Notice message={notice ? NOTICES[notice] : undefined} />
      <CalendarError error={params.error} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Event types" className="flex flex-wrap gap-2">
          <Link href={link(undefined, past)} className={chip(!type)} aria-current={!type ? "page" : undefined}>
            All
          </Link>
          {EVENT_TYPES.map((t) => (
            <Link key={t.value} href={link(t.value, past)} className={chip(type === t.value)} aria-current={type === t.value ? "page" : undefined}>
              {t.plural}
            </Link>
          ))}
        </nav>
        <Link href={link(type, !past)} className="text-sm font-medium text-sky-800 underline underline-offset-2 hover:text-sky-950">
          {past ? "Back to upcoming events" : "Past events"}
        </Link>
      </div>

      {events.length === 0 && (
        <p className="text-slate-600">
          {past ? "No past events in the last 12 months." : "There are no upcoming events on the calendar yet. Please check back later."}
        </p>
      )}

      {months.map((m) => (
        <section key={m.heading} aria-label={m.heading} className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-800">{m.heading}</h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
            {m.events.map((e) => {
              const info = typeInfo(e.event_type);
              const onEvent = people.filter((p) => p.event_id === e.id);
              const going = onEvent.filter((p) => p.kind === "attending");
              const goingNames = going.filter((p) => p.first_name).map(fullName);
              const goingIds = new Set(going.map((p) => p.person_id).filter(Boolean));
              const isPast = e.event_date < today;
              const canChange = !isPast || isAdmin;
              return (
                <li key={e.id} id={`event-${e.id}`} aria-label={e.title} className="flex scroll-mt-4 gap-4 p-4">
                  <div className="w-14 shrink-0 self-start rounded border border-slate-200 py-1 text-center" aria-hidden="true">
                    <div className="text-xs font-medium uppercase text-slate-500">{weekday(e.event_date)}</div>
                    <div className="text-xl font-semibold leading-tight">{dayOfMonth(e.event_date)}</div>
                    <div className="text-xs text-slate-500">{monthShort(e.event_date)}</div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-semibold text-slate-700">{startTime(e.start_time)}</span>
                        <h3 className="font-semibold">{e.title}</h3>
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${info.badge}`}>{info.label}</span>
                      </div>
                      {isAdmin && (
                        <Link
                          href={`/calendar/${e.id}/edit`}
                          aria-label={`Edit ${e.title}`}
                          className="rounded border border-slate-400 px-3 py-1 text-sm font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900"
                        >
                          Edit
                        </Link>
                      )}
                    </div>
                    <p className="sr-only">
                      {weekday(e.event_date)} {dayOfMonth(e.event_date)} {monthShort(e.event_date)}
                    </p>

                    {DUTIES[e.event_type].length > 0 && (
                      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                        {DUTIES[e.event_type].map((d) => {
                          const holder = onEvent.find((p) => p.kind === d.role);
                          const mine = holder?.person_id === personId;
                          return (
                            <li key={d.role} className="flex items-center gap-2">
                              <span className="font-medium">{d.label}: </span>
                              {holder ? (
                                <span>{holder.first_name ? fullName(holder) : "Filled"}</span>
                              ) : (
                                <span className="font-medium text-amber-800">Needed</span>
                              )}
                              {canChange && !isPast && (mine || (!holder && meAdult)) && (
                                <form action={toggleDuty}>
                                  <input type="hidden" name="event" value={e.id} />
                                  <input type="hidden" name="role" value={d.role} />
                                  <input type="hidden" name="on" value={mine ? "0" : "1"} />
                                  <input type="hidden" name="view" value={viewString} />
                                  <SaveButton variant="link" pendingText="…" aria-label={`${mine ? "Give up" : "Take"} ${d.label} for ${e.title}`}>
                                    {mine ? "Give up" : "I'll do it"}
                                  </SaveButton>
                                </form>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <p className="text-sm text-slate-700">
                      <span className="font-medium">{isPast ? "Went:" : "Going:"}</span>{" "}
                      {going.length === 0 ? "Nobody yet" : `${going.length} · ${nameList(goingNames, going.length - goingNames.length)}`}
                    </p>

                    {canChange && helpers.length > 0 && (
                      <div className="flex flex-wrap gap-2" role="group" aria-label={`Going to ${e.title}`}>
                        {helpers.map((h) => {
                          const on = goingIds.has(h.id);
                          const who = h.is_me ? `${h.first_name} (you)` : h.first_name;
                          return (
                            <form key={h.id} action={toggleAttending}>
                              <input type="hidden" name="event" value={e.id} />
                              <input type="hidden" name="person" value={h.id} />
                              <input type="hidden" name="on" value={on ? "0" : "1"} />
                              <input type="hidden" name="view" value={viewString} />
                              <SaveButton
                                variant={on ? "primary" : "secondary"}
                                pendingText="…"
                                aria-label={on ? `Take ${h.first_name} off ${e.title}` : `Put ${h.first_name} down for ${e.title}`}
                              >
                                {on ? "✓" : "+"} {who}
                              </SaveButton>
                            </form>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
