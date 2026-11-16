import Link from "next/link";
import { NotAllowed } from "@/components/admin";
import { meWithRole } from "@/lib/me";
import { CalendarError } from "../errors";
import { EventForm } from "../event-form";

export default async function NewEventPage({ searchParams }: PageProps<"/calendar/new">) {
  const { error } = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;
  const { data: people } = await supabase.rpc("calendar_duty_people");
  return (
    <div className="space-y-6">
      <div>
        <Link href="/calendar" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
          ← Back to Calendar
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Add an event</h1>
        <p className="mt-1 text-sm text-slate-600">It appears on the Calendar for every member.</p>
      </div>
      <CalendarError error={error} />
      <EventForm event={null} duties={{}} people={people ?? []} />
    </div>
  );
}
