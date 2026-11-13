import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { JoinForm, type JoinOption } from "./join-form";

export const metadata: Metadata = { title: "Join Burwain" };

// The public Join page: no login needed.
export default async function JoinPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("join_options");
  const options = (data ?? []) as JoinOption[];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Join Burwain</h1>
        <p className="text-slate-700">
          Fill in this form to apply for membership. You can pay straight away, or the membership secretary will
          email you about paying. Once you&apos;re accepted you can log in with your email to see and update your details.
        </p>
      </div>
      {options.length === 0 ? (
        <p className="rounded border border-slate-200 bg-white p-4 text-slate-700">
          Joining isn&apos;t open at the moment. Please contact the membership secretary.
        </p>
      ) : (
        <JoinForm options={options} />
      )}
    </div>
  );
}
