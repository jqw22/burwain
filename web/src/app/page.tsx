import { Card } from "@/components/fields";
import { createClient } from "@/lib/supabase/server";

// Home is where everyone lands after signing in.
export default async function HomePage() {
  const supabase = await createClient();

  // First sign-in: attach this login to the member record with the same email.
  const { data: personId } = await supabase.rpc("link_my_account");

  if (!personId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <h1 className="text-xl font-semibold">We couldn&apos;t find your membership</h1>
        <p className="mt-2 text-slate-700">
          You&apos;re signed in, but this email address doesn&apos;t match a member record. Please
          contact the membership secretary so they can link your account.
        </p>
      </div>
    );
  }

  const { data: me } = await supabase.from("people").select("first_name").eq("id", personId).single();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Welcome to Burwain{me?.first_name ? `, ${me.first_name}` : ""}</h1>
      <Card title="Coming soon">
        <p className="text-slate-700">Club news and notices will appear here.</p>
      </Card>
    </div>
  );
}
