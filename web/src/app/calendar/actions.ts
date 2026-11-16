"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DUTIES, EVENT_TYPES, type EventType } from "@/lib/calendar";
import { meWithRole, requireMe } from "@/lib/me";

const ID = /^[0-9a-f-]{36}$/i;
const ROLES = ["officer", "assistant", "trainer"];

// Keep the member on the same view of the calendar (type filter, past events) after a button press.
function back(form: FormData, event: string, error?: string) {
  const q = new URLSearchParams();
  const view = String(form.get("view") ?? "");
  for (const [k, v] of new URLSearchParams(view)) if (k === "type" || k === "past") q.set(k, v);
  if (error) q.set("error", error);
  const s = q.toString();
  return `/calendar${s ? `?${s}` : ""}#event-${event}`;
}

function reason(message: string) {
  if (/already happened/.test(message)) return "past";
  if (/already taken/.test(message)) return "taken";
  if (/no longer on the calendar/.test(message)) return "gone";
  if (/adult members/.test(message)) return "duty";
  return "signup";
}

// "+" puts a name down as going; clicking again takes it off.
export async function toggleAttending(form: FormData) {
  const event = String(form.get("event") ?? "");
  const person = String(form.get("person") ?? "");
  if (!ID.test(event) || !ID.test(person)) redirect("/calendar");
  const { supabase } = await requireMe();
  const { error } = await supabase.rpc("calendar_attend", { p_event: event, p_person: person, p_going: form.get("on") === "1" });
  if (error) redirect(back(form, event, reason(error.message)));
  revalidatePath("/calendar");
  revalidatePath("/");
  redirect(back(form, event));
}

// A member takes an empty duty for themselves, or gives up their own.
export async function toggleDuty(form: FormData) {
  const event = String(form.get("event") ?? "");
  const role = String(form.get("role") ?? "");
  if (!ID.test(event) || !ROLES.includes(role)) redirect("/calendar");
  const { supabase, personId } = await requireMe();
  const { error } = await supabase.rpc("calendar_set_duty", {
    p_event: event,
    p_role: role,
    p_person: form.get("on") === "1" ? personId : null,
  });
  if (error) redirect(back(form, event, reason(error.message)));
  revalidatePath("/calendar");
  redirect(back(form, event));
}

// Admins add or change an event, and fill its duties.
export async function saveEvent(form: FormData) {
  const id = String(form.get("id") ?? "");
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed) redirect("/calendar");
  const again = id ? `/calendar/${encodeURIComponent(id)}/edit` : "/calendar/new";
  const type = String(form.get("event_type") ?? "") as EventType;
  const title = String(form.get("title") ?? "").trim();
  const date = String(form.get("event_date") ?? "").trim();
  const time = String(form.get("start_time") ?? "").trim();
  if (!EVENT_TYPES.some((t) => t.value === type)) redirect(`${again}?error=type`);
  if (!title) redirect(`${again}?error=title`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(`${again}?error=date`);
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) redirect(`${again}?error=time`);

  const fields = { event_type: type, title, event_date: date, start_time: time };
  const result = id
    ? await supabase.from("calendar_events").update({ ...fields, updated_by: personId }).eq("id", id).select("id")
    : await supabase.from("calendar_events").insert({ ...fields, created_by: personId, updated_by: personId }).select("id");
  if (result.error || !result.data?.length) redirect(`${again}?error=save`);
  const eventId = result.data[0].id as string;

  for (const { role } of DUTIES[type]) {
    const person = String(form.get(`duty_${role}`) ?? "");
    const { error } = await supabase.rpc("calendar_set_duty", {
      p_event: eventId,
      p_role: role,
      p_person: ID.test(person) ? person : null,
    });
    if (error) redirect(`/calendar/${eventId}/edit?error=dutysave`);
  }
  revalidatePath("/calendar");
  revalidatePath("/");
  redirect(`/calendar?saved=1#event-${eventId}`);
}

// Admins delete an event (e.g. cancelled or added by mistake). Its duties and attendance go with it.
export async function deleteEvent(form: FormData) {
  const id = String(form.get("id") ?? "");
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed || !ID.test(id)) redirect("/calendar");
  const { data, error } = await supabase.from("calendar_events").delete().eq("id", id).select("id");
  if (error || !data?.length) redirect(`/calendar/${encodeURIComponent(id)}/edit?error=delete`);
  revalidatePath("/calendar");
  revalidatePath("/");
  redirect("/calendar?deleted=1");
}
