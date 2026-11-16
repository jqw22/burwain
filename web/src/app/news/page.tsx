import Link from "next/link";
import { Card } from "@/components/fields";
import { meWithRole } from "@/lib/me";
import type { NewsPost } from "@/lib/news";
import { addPostLink, NewsList } from "./news-list";

// Every club news post, for reading older news that has dropped off the Home page.
export default async function AllNewsPage() {
  const { supabase, allowed: isAdmin } = await meWithRole("admin");
  const { data } = await supabase
    .from("news_posts")
    .select("id, title, body, pinned, created_at, updated_at")
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
          ← Back to Home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">All club news</h1>
      </div>
      <Card title="Club news" action={isAdmin ? addPostLink : undefined}>
        <NewsList posts={(data ?? []) as NewsPost[]} isAdmin={isAdmin} />
      </Card>
    </div>
  );
}
