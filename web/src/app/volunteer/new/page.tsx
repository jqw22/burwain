import Link from "next/link";
import { NotAllowed } from "@/components/admin";
import { meWithRole } from "@/lib/me";
import { VolunteerError } from "../errors";
import { JobForm } from "../job-form";

export default async function NewJobPage({ searchParams }: PageProps<"/volunteer/new">) {
  const { error } = await searchParams;
  const { allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;
  return (
    <div className="space-y-6">
      <div>
        <Link href="/volunteer" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
          ← Back to Volunteering
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Add a job</h1>
        <p className="mt-1 text-sm text-slate-600">It appears on the Volunteering page for every member.</p>
      </div>
      <VolunteerError error={error} />
      <JobForm job={null} helpers={0} />
    </div>
  );
}
