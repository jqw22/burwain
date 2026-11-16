"use client";

import Link from "next/link";
import { useState } from "react";
import { SaveButton } from "@/components/save-button";
import { deleteJob, saveJob, setJobDone } from "./actions";

export type Job = {
  id: string;
  title: string;
  description: string;
  job_date: string | null;
  helpers_needed: number | null;
  done_at: string | null;
};

const INPUT = "mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2";

// Admins add or change a job: title, what's involved, an optional date and an optional number of helpers.
export function JobForm({ job, helpers }: { job: Job | null; helpers: number }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="space-y-6">
      <form action={saveJob} className="space-y-4" aria-label={job ? "Edit job" : "New job"}>
        {job && <input type="hidden" name="id" value={job.id} />}
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Job</span>
          <input name="title" required defaultValue={job?.title ?? ""} className={INPUT} placeholder="e.g. Paint the boathouse doors" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-700">What&apos;s involved (optional)</span>
          <textarea name="description" rows={4} defaultValue={job?.description ?? ""} className={INPUT} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Date (optional)</span>
            <input name="job_date" type="date" defaultValue={job?.job_date ?? ""} className={INPUT} />
            <span className="mt-1 block text-xs text-slate-500">Leave blank if it can be done any time.</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Helpers needed (optional)</span>
            <input name="helpers_needed" type="number" min={1} step={1} defaultValue={job?.helpers_needed ?? ""} className={INPUT} />
            <span className="mt-1 block text-xs text-slate-500">Leave blank for no limit. When it&apos;s full the + buttons stop.</span>
          </label>
        </div>
        <div className="flex items-center gap-4">
          <SaveButton>{job ? "Save job" : "Add job"}</SaveButton>
          <Link href="/volunteer" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
            Cancel
          </Link>
        </div>
      </form>

      {job && (
        <div className="space-y-4 border-t border-slate-200 pt-4">
          <form action={setJobDone}>
            <input type="hidden" name="id" value={job.id} />
            <input type="hidden" name="done" value={job.done_at ? "0" : "1"} />
            <SaveButton variant="secondary" pendingText="Saving…">
              {job.done_at ? "Reopen this job" : "Mark as done"}
            </SaveButton>
            <p className="mt-1 text-xs text-slate-500">
              {job.done_at
                ? "Puts the job back on the Volunteering page."
                : "Takes the job off the Volunteering page. Who helped is kept for the record."}
            </p>
          </form>
          {helpers === 0 && (
            <form action={deleteJob}>
              <input type="hidden" name="id" value={job.id} />
              {!confirmDelete ? (
                <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-medium text-red-800 underline underline-offset-2">
                  Delete this job
                </button>
              ) : (
                <div className="space-y-3 rounded border border-red-300 bg-red-50 p-4" role="alertdialog" aria-label="Confirm delete">
                  <p className="font-medium text-red-950">Delete this job? Nobody has signed up for it yet.</p>
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
      )}
    </div>
  );
}
