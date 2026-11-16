import Link from "next/link";
import { Card, Notice } from "@/components/fields";
import { SaveButton } from "@/components/save-button";
import { meWithRole, ukDate } from "@/lib/me";
import { toggleVolunteer } from "./actions";
import { VolunteerError } from "./errors";
import type { Job } from "./job-form";

type Signup = { job_id: string; person_id: string | null; first_name: string | null; last_name: string | null };
type Helper = { id: string; first_name: string; last_name: string; is_me: boolean };
type DoneSignup = { job_id: string; person: { first_name: string; last_name: string } | null };

function jobDate(iso: string | null) {
  if (!iso) return "Any time";
  const d = new Date(`${iso}T12:00:00`);
  // "Sat 6 Mar 2027"
  return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

// "Sam Smith, Alex Smith and 2 others"
function helperNames(names: string[], hidden: number) {
  const parts = [...names];
  if (hidden > 0) parts.push(`${hidden} other${hidden === 1 ? "" : "s"}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const NOTICES: Record<string, string> = { saved: "Job saved.", done: "Job marked as done.", reopened: "Job reopened.", deleted: "Job deleted." };

// Volunteering: jobs that need doing. Members click + to put themselves (adults) or, as a family's main
// contact, anyone in their family down for a job. Admins add, edit and finish jobs.
export default async function VolunteerPage({ searchParams }: PageProps<"/volunteer">) {
  const params = await searchParams;
  const { supabase, allowed: isAdmin } = await meWithRole("admin");
  const [{ data: jobData }, { data: signupData }, { data: peopleData }] = await Promise.all([
    supabase
      .from("volunteer_jobs")
      .select("id, title, description, job_date, helpers_needed, done_at")
      .order("job_date", { ascending: true, nullsFirst: false })
      .order("created_at"),
    supabase.rpc("volunteer_signup_names"),
    supabase.rpc("my_volunteer_people"),
  ]);
  const jobs = (jobData ?? []) as Job[];
  const open = jobs.filter((j) => !j.done_at);
  const signups = (signupData ?? []) as Signup[];
  const helpers = (peopleData ?? []) as Helper[];

  // Admins also see finished jobs, with who helped, at the bottom.
  const finished = isAdmin ? jobs.filter((j) => j.done_at).sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? "")) : [];
  let doneSignups: DoneSignup[] = [];
  if (finished.length) {
    const { data } = await supabase
      .from("volunteer_signups")
      .select("job_id, person:people!volunteer_signups_person_id_fkey(first_name, last_name)")
      .in("job_id", finished.map((j) => j.id));
    doneSignups = (data ?? []) as unknown as DoneSignup[];
  }
  const notice = Object.keys(NOTICES).find((k) => params[k]);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">Volunteering</h1>
        {isAdmin && (
          <Link href="/volunteer/new" className="rounded bg-sky-800 px-4 py-2 text-sm font-medium text-white hover:bg-sky-950">
            + Add job
          </Link>
        )}
      </div>
      <p className="text-slate-700">
        If you are able to contribute to any of the jobs below, no matter how small, your support would be appreciated by
        all. Simply click the + icon to indicate you are available.
      </p>
      <Notice message={notice ? NOTICES[notice] : undefined} />
      <VolunteerError error={params.error} />

      {open.length === 0 && (
        <p className="text-slate-600">There are no jobs listed at the moment. Please check back later.</p>
      )}

      {open.map((job) => {
        const onJob = signups.filter((s) => s.job_id === job.id);
        const names = onJob.filter((s) => s.first_name).map((s) => `${s.first_name} ${s.last_name}`);
        const hidden = onJob.length - names.length;
        const full = job.helpers_needed !== null && onJob.length >= job.helpers_needed;
        const mine = new Set(onJob.map((s) => s.person_id).filter(Boolean));
        return (
          <Card
            key={job.id}
            id={`job-${job.id}`}
            title={job.title}
            action={
              isAdmin ? (
                <Link
                  href={`/volunteer/${job.id}/edit`}
                  aria-label={`Edit ${job.title}`}
                  className="rounded border border-slate-400 px-3 py-1 text-sm font-medium text-slate-800 hover:border-sky-800 hover:bg-sky-50 hover:text-sky-900"
                >
                  Edit
                </Link>
              ) : undefined
            }
          >
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-600">
                {jobDate(job.job_date)}
                {" · "}
                {job.helpers_needed !== null
                  ? `${onJob.length} of ${job.helpers_needed} helpers${full ? " (full)" : ""}`
                  : onJob.length === 0
                    ? "No helpers yet"
                    : `${onJob.length} ${onJob.length === 1 ? "helper" : "helpers"}`}
              </p>
              {job.description && <p className="whitespace-pre-line text-slate-700">{job.description}</p>}
              {onJob.length > 0 && (
                <p className="text-sm text-slate-700">
                  <span className="font-medium">Helping:</span> {helperNames(names, hidden)}
                </p>
              )}
              {helpers.length > 0 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label={`Volunteer for ${job.title}`}>
                  {helpers.map((h) => {
                    const on = mine.has(h.id);
                    const who = h.is_me ? `${h.first_name} (you)` : h.first_name;
                    return (
                      <form key={h.id} action={toggleVolunteer}>
                        <input type="hidden" name="job" value={job.id} />
                        <input type="hidden" name="person" value={h.id} />
                        <input type="hidden" name="on" value={on ? "0" : "1"} />
                        {on ? (
                          <SaveButton variant="primary" pendingText="…" aria-label={`Take ${h.first_name} off ${job.title}`}>
                            ✓ {who}
                          </SaveButton>
                        ) : (
                          <SaveButton
                            variant="secondary"
                            pendingText="…"
                            disabled={full}
                            aria-label={`Put ${h.first_name} down for ${job.title}`}
                          >
                            + {who}
                          </SaveButton>
                        )}
                      </form>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        );
      })}

      {finished.length > 0 && (
        <Card title="Finished jobs">
          <p className="mb-3 text-sm text-slate-600">Only admins see this list. Who helped is kept for the record.</p>
          <ul className="divide-y divide-slate-100">
            {finished.map((job) => {
              const who = doneSignups
                .filter((s) => s.job_id === job.id && s.person)
                .map((s) => `${s.person!.first_name} ${s.person!.last_name}`)
                .sort();
              return (
                <li key={job.id} className="flex items-baseline justify-between gap-4 py-2">
                  <div>
                    <p className="font-medium">{job.title}</p>
                    <p className="text-sm text-slate-600">
                      Done {ukDate(job.done_at)} · {who.length ? helperNames(who, 0) : "No helpers"}
                    </p>
                  </div>
                  <Link href={`/volunteer/${job.id}/edit`} className="text-sm text-sky-800 underline">
                    Edit
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
