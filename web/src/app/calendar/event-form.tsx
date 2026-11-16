"use client";

import Link from "next/link";
import { useState } from "react";
import { SaveButton } from "@/components/save-button";
import { DUTIES, EVENT_TYPES, type CalendarEvent, type DutyRole, type EventType } from "@/lib/calendar";
import { deleteEvent, saveEvent } from "./actions";

const INPUT = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";

type DutyPerson = { id: string; first_name: string; last_name: string };

// Admins add or change an event: type, title, date and start time. Sailing events also have an
// Officer and an Assistant, training events a Trainer; these can be left empty for members to take.
export function EventForm({
  event,
  duties,
  people,
}: {
  event: CalendarEvent | null;
  duties: Partial<Record<DutyRole, string>>;
  people: DutyPerson[];
}) {
  const [type, setType] = useState<EventType | "">(event?.event_type ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const needed = type ? DUTIES[type] : [];
  return (
    <div className="space-y-6">
      <form action={saveEvent} className="space-y-4" aria-label={event ? "Edit event" : "New event"}>
        {event && <input type="hidden" name="id" value={event.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Type</span>
            <select name="event_type" required value={type} onChange={(e) => setType(e.target.value as EventType)} className={INPUT}>
              <option value="" disabled>
                Choose…
              </option>
              {EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Title</span>
            <input name="title" required defaultValue={event?.title ?? ""} className={INPUT} placeholder="e.g. Sunday club racing" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Date</span>
            <input name="event_date" type="date" required defaultValue={event?.event_date ?? ""} className={INPUT} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Start time</span>
            <input name="start_time" type="time" required defaultValue={event ? event.start_time.slice(0, 5) : ""} className={INPUT} />
          </label>
        </div>

        {needed.length > 0 && (
          <fieldset className="space-y-3 rounded border border-slate-200 p-4">
            <legend className="px-1 text-sm font-medium text-slate-700">
              {type === "sailing" ? "Sailing events need an Officer and an Assistant" : "Training events need a Trainer"}
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              {needed.map((d) => (
                <label key={d.role} className="block">
                  <span className="text-sm font-medium text-slate-700">{d.label}</span>
                  <select name={`duty_${d.role}`} defaultValue={duties[d.role] ?? ""} className={INPUT}>
                    <option value="">Not filled yet</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.first_name} {p.last_name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Leave a duty as &quot;Not filled yet&quot; and adult members can put themselves forward on the Calendar page.
            </p>
          </fieldset>
        )}

        <div className="flex items-center gap-4">
          <SaveButton>{event ? "Save event" : "Add event"}</SaveButton>
          <Link href="/calendar" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
            Cancel
          </Link>
        </div>
      </form>

      {event && (
        <form action={deleteEvent} className="border-t border-slate-200 pt-4">
          <input type="hidden" name="id" value={event.id} />
          {!confirmDelete ? (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-medium text-red-800 underline underline-offset-2">
              Delete this event
            </button>
          ) : (
            <div className="space-y-3 rounded border border-red-300 bg-red-50 p-4" role="alertdialog" aria-label="Confirm delete">
              <p className="font-medium text-red-950">Delete this event? Anyone who said they were going is removed too.</p>
              <div className="flex items-center gap-4">
                <button type="submit" className="rounded bg-red-800 px-4 py-2 font-medium text-white hover:bg-red-950">
                  Yes, delete
                </button>
                <button type="button" className="text-sm text-slate-700 underline" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
