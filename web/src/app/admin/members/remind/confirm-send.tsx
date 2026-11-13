"use client";

import { useState } from "react";
import { SaveButton } from "@/components/save-button";

// "Send to N members", then an on-page "are you sure" before the form is submitted.
export function ConfirmSend({ count }: { count: number }) {
  const [confirming, setConfirming] = useState(false);
  const members = `${count} ${count === 1 ? "member" : "members"}`;
  if (!confirming)
    return (
      <button
        type="button"
        disabled={count === 0}
        onClick={() => setConfirming(true)}
        className="rounded bg-sky-800 px-4 py-2 font-medium text-white hover:bg-sky-950 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        Send to {members}
      </button>
    );
  return (
    <div className="space-y-3 rounded border border-amber-300 bg-amber-50 p-4" role="alertdialog" aria-label="Confirm sending">
      <p className="font-medium text-amber-950">You&apos;re about to email {members}. Emails can&apos;t be unsent once they&apos;ve gone.</p>
      <div className="flex items-center gap-4">
        <SaveButton pendingText="Sending…">Yes, send now</SaveButton>
        <button type="button" className="text-sm text-slate-700 underline" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
