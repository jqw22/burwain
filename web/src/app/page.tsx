import Link from "next/link";
import { Card } from "@/components/fields";
import type { NewsPost } from "@/lib/news";
import { createClient } from "@/lib/supabase/server";
import { addPostLink, NewsList } from "./news/news-list";

const LATEST = 5;

// Home is where everyone lands after signing in.
export default async function HomePage({ searchParams }: PageProps<"/">) {
  const { news } = await searchParams;
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

  const [{ data: me }, { data: isAdmin }, { data: posts, count }] = await Promise.all([
    supabase.from("people").select("first_name").eq("id", personId).single(),
    supabase.rpc("has_role", { r: "admin" }),
    supabase
      .from("news_posts")
      .select("id, title, body, pinned, created_at, updated_at", { count: "exact" })
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(LATEST),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Welcome to Burwain{me?.first_name ? `, ${me.first_name}` : ""}</h1>
      {news && (
        <p className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900" role="status">
          {news === "deleted" ? "News post deleted." : "News post saved."}
        </p>
      )}
      {/* Club news takes two thirds of the width on a computer; the box beside it is kept for upcoming events. */}
      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2">
          <Card title="Club news" action={isAdmin ? addPostLink : undefined}>
            <NewsList posts={(posts ?? []) as NewsPost[]} isAdmin={Boolean(isAdmin)} />
            {(count ?? 0) > LATEST && (
              <p className="mt-4 border-t border-slate-200 pt-3">
                <Link href="/news" className="text-sm font-medium text-sky-800 underline underline-offset-2 hover:text-sky-950">
                  Older news
                </Link>
              </p>
            )}
          </Card>
        </div>
        <div>
          <Card title="Coming up">
            <p className="text-sm text-slate-500">Upcoming events will appear here.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
