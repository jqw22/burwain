import Link from "next/link";
import { notFound } from "next/navigation";
import { NotAllowed } from "@/components/admin";
import { meWithRole, ukDate } from "@/lib/me";
import { cleanNewsHtml } from "@/lib/news";
import { NewsError } from "../../errors";
import { NewsForm } from "../../news-form";

export default async function EditNewsPostPage({ params, searchParams }: PageProps<"/news/[id]/edit">) {
  const { id } = await params;
  const { error } = await searchParams;
  const { supabase, allowed } = await meWithRole("admin");
  if (!allowed) return <NotAllowed />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data: post } = await supabase
    .from("news_posts")
    .select("id, title, body, pinned, created_at, updated_at, editor:people!news_posts_updated_by_fkey(first_name, last_name)")
    .eq("id", id)
    .maybeSingle();
  if (!post) notFound();
  const editor = post.editor as unknown as { first_name: string; last_name: string } | null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-slate-600 underline underline-offset-2 hover:text-sky-900">
          ← Back to Home
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit news post</h1>
        <p className="mt-1 text-sm text-slate-600">
          Posted {ukDate(post.created_at)}. Last changed {ukDate(post.updated_at)}
          {editor ? ` by ${editor.first_name} ${editor.last_name}` : ""}.
        </p>
      </div>
      <NewsError error={error} />
      <NewsForm post={{ id: post.id, title: post.title, body: cleanNewsHtml(post.body), pinned: post.pinned }} />
    </div>
  );
}
