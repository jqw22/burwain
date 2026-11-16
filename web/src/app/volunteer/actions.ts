"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { meWithRole, requireMe } from "@/lib/me";

const ID = /^[0-9a-f-]{36}$/i;

// "+" puts a name down for a job; clicking again takes it off. Members can do this for themselves
// (adults) and, if they are the family's main contact, for anyone in their family. The database checks.
export async function toggleVolunteer(form: FormData) {
  const job = String(form.get("job") ?? "");
  const person = String(form.get("person") ?? "");
  const on = form.get("on") === "1";
  if (!ID.test(job) || !ID.test(person)) redirect("/volunteer");
  const { supabase } = await requireMe();
  const { error } = await supabase.rpc(on ? "volunteer_sign_up" : "volunteer_withdraw", { p_job: job, p_person: person });
  if (error) {
    const reason = /all the helpers/.test(error.message) ? "full" : /no longer open/.test(error.message) ? "closed" : "signup";
    redirect(`/volunteer?error=${reason}#job-${job}`);
  }
  revalidatePath("/volunteer");
  redirect(`/volunteer#job-${job}`);
}

function jobFields(form: FormData) {
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const date = String(form.get("job_date") ?? "").trim();
  const helpers = String(form.get("helpers_needed") ?? "").trim();
  const helpersNeeded = helpers === "" ? null : Number(helpers);
  return {
    title,
    description,
    job_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    helpers_needed: helpersNeeded !== null && Number.isInteger(helpersNeeded) && helpersNeeded > 0 ? helpersNeeded : null,
    badHelpers: helpersNeeded !== null && !(Number.isInteger(helpersNeeded) && helpersNeeded > 0),
  };
}

// Admins add or change a job.
export async function saveJob(form: FormData) {
  const id = String(form.get("id") ?? "");
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed) redirect("/volunteer");
  const back = id ? `/volunteer/${encodeURIComponent(id)}/edit` : "/volunteer/new";
  const { badHelpers, ...fields } = jobFields(form);
  if (!fields.title) redirect(`${back}?error=title`);
  if (badHelpers) redirect(`${back}?error=helpers`);
  const result = id
    ? await supabase.from("volunteer_jobs").update({ ...fields, updated_by: personId }).eq("id", id).select("id")
    : await supabase.from("volunteer_jobs").insert({ ...fields, created_by: personId, updated_by: personId }).select("id");
  if (result.error || !result.data?.length) redirect(`${back}?error=save`);
  revalidatePath("/volunteer");
  redirect(`/volunteer?saved=1#job-${result.data[0].id}`);
}

// Admins mark a job done (it leaves the list but keeps its helpers) or reopen it.
export async function setJobDone(form: FormData) {
  const id = String(form.get("id") ?? "");
  const done = form.get("done") === "1";
  const { supabase, personId, allowed } = await meWithRole("admin");
  if (!allowed || !ID.test(id)) redirect("/volunteer");
  const { data, error } = await supabase
    .from("volunteer_jobs")
    .update({ done_at: done ? new Date().toISOString() : null, done_by: done ? personId : null, updated_by: personId })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) redirect(`/volunteer/${encodeURIComponent(id)}/edit?error=save`);
  revalidatePath("/volunteer");
  redirect(done ? "/volunteer?done=1" : `/volunteer?reopened=1#job-${id}`);
}

// A job nobody has signed up for can be deleted (e.g. added by mistake).
export async function deleteJob(form: FormData) {
  const id = String(form.get("id") ?? "");
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed || !ID.test(id)) redirect("/volunteer");
  const { data, error } = await supabase.from("volunteer_jobs").delete().eq("id", id).select("id");
  if (error || !data?.length) redirect(`/volunteer/${encodeURIComponent(id)}/edit?error=delete`);
  revalidatePath("/volunteer");
  redirect("/volunteer?deleted=1");
}
