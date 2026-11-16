import Link from "next/link";
import { notFound } from "next/navigation";
import { NotAllowed } from "@/components/admin";
import { meWithRole, ukDate } from "@/lib/me";
import { VolunteerError } from "../../errors";
import { JobForm, type Job } from "../../job-form";

export default async function EditJobPage({ params, searchParams }: PageProps<"/volunteer/[id]/edit">) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [{ data: job }, { count }] = await Promise.all([
    supabase.from("volunteer_jobs").select("id, title, description, job_date, helpers_needed, done_at, created_at").eq("id", id).maybeSingle(),
    supabase.from("volunteer_signups").select("person_id", { count: "exact", head: true }).eq("job_id", id),
  ]);
  if (!job) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/volunteer" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
          ← Back to Volunteering
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit job</h1>
        <p className="mt-1 text-sm text-slate-600">
          Added {ukDate(job.created_at)}.{job.done_at ? ` Marked done ${ukDate(job.done_at)}.` : ""}
        </p>
      </div>
      <VolunteerError error={error} />
      <JobForm job={job as Job} helpers={count ?? 0} />
    </div>
  );
}
