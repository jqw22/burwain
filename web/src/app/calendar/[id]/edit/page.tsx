import Link from "next/link";
import { notFound } from "next/navigation";
import { NotAllowed } from "@/components/admin";
import type { CalendarEvent, DutyRole } from "@/lib/calendar";
import { meWithRole, ukDate } from "@/lib/me";
import { CalendarError } from "../../errors";
import { EventForm } from "../../event-form";

export default async function EditEventPage({ params, searchParams }: PageProps<"/calendar/[id]/edit">) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [{ data: event }, { data: dutyRows }, { data: people }] = await Promise.all([
    supabase.from("calendar_events").select("id, event_type, title, event_date, start_time, created_at").eq("id", id).maybeSingle(),
    supabase.from("calendar_duties").select("role, person_id").eq("event_id", id),
    supabase.rpc("calendar_duty_people"),
  ]);
  if (!event) notFound();
  const duties: Partial<Record<DutyRole, string>> = {};
  for (const d of dutyRows ?? []) duties[d.role as DutyRole] = d.person_id;

  // Someone already on a duty stays in the list even if their membership has since lapsed.
  const list = [...(people ?? [])] as { id: string; first_name: string; last_name: string }[];
  const missing = Object.values(duties).filter((p) => p && !list.some((x) => x.id === p));
  if (missing.length) {
    const { data } = await supabase.from("people").select("id, first_name, last_name").in("id", missing);
    list.push(...(data ?? []));
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/calendar" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
          ← Back to Calendar
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit event</h1>
        <p className="mt-1 text-sm text-slate-600">Added {ukDate(event.created_at)}.</p>
      </div>
      <CalendarError error={error} />
      <EventForm event={event as CalendarEvent} duties={duties} people={list} />
    </div>
  );
}
