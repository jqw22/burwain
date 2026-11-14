"use client";

import { useRouter } from "next/navigation";
import { ImageButton } from "@/components/image-button";
import { SaveButton } from "@/components/save-button";
import { removeLogo } from "./image-actions";

// The club logo shown at the top of emails: upload, replace or remove it.
export function LogoControls({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  return (
    <div className="space-y-3">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="Club logo" className="max-h-[60px] max-w-[100px] rounded border border-slate-200 p-2" />
      ) : (
        <p className="text-sm text-slate-600">No logo yet. Emails are sent without one.</p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <ImageButton logo label={logoUrl ? "Replace logo" : "Upload logo"} onUploaded={() => router.refresh()} />
        {logoUrl && (
          <form action={removeLogo}>
            <SaveButton variant="link" pendingText="Removing…">
              Remove logo
            </SaveButton>
          </form>
        )}
      </div>
    </div>
  );
}
